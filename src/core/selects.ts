import type { Cue } from "./srt.js";
import { rangeText } from "./srt.js";
import { clipFor, type SourceSequence } from "./premiere.js";
import { framesToSec, framesToTc, secToFrames, secToMinSec } from "./timecode.js";

export const DEFAULT_THEMES = ["Company story", "Vision", "Founder tip", "Insight"] as const;

/** One soundbite: an inclusive range of SRT cues, in cut order. */
export interface Select {
  theme: string;
  cueStart: number;
  cueEnd: number;
  /** Optional cleaned line for the paper edit (otherwise derived from cues). */
  line?: string;
  /** Why it was picked — shown in the review UI, not exported to the client. */
  note?: string;
}

export interface SelectCheck {
  index: number;
  theme: string;
  cueStart: number;
  cueEnd: number;
  f0: number; // sequence frames
  f1: number;
  seconds: number;
  text: string;
  error?: string;
}

export interface CheckResult {
  rows: SelectCheck[];
  totalSeconds: number;
  ok: boolean;
  errors: string[];
}

export function checkSelects(selects: Select[], cues: Map<number, Cue>, src: SourceSequence): CheckResult {
  const rows: SelectCheck[] = [];
  const errors: string[] = [];
  let total = 0;
  selects.forEach((s, i) => {
    const label = `S${String(i + 1).padStart(2, "0")}`;
    const a = cues.get(s.cueStart);
    const b = cues.get(s.cueEnd);
    let error: string | undefined;
    if (!a || !b) error = `cue ${!a ? s.cueStart : s.cueEnd} does not exist`;
    else if (s.cueEnd < s.cueStart) error = "cueEnd is before cueStart";
    const f0 = a ? secToFrames(a.start, src.rate) : 0;
    const f1 = b ? secToFrames(b.end, src.rate) : 0;
    if (!error) {
      if (!clipFor(src.video, f0, f1)) error = "crosses a camera clip boundary (or falls outside the video) — split it into two selects";
      else if (!clipFor(src.audio.clips, f0, f1)) error = "crosses an audio clip boundary — split it into two selects";
    }
    const seconds = error ? 0 : framesToSec(f1 - f0, src.rate);
    total += seconds;
    if (error) errors.push(`${label} (${s.cueStart}-${s.cueEnd}): ${error}`);
    rows.push({ index: i + 1, theme: s.theme, cueStart: s.cueStart, cueEnd: s.cueEnd, f0, f1, seconds, text: rangeText(cues, s.cueStart, s.cueEnd), error });
  });
  // overlapping selects are almost always a mistake
  const sorted = [...selects].map((s, i) => ({ ...s, i })).sort((x, y) => x.cueStart - y.cueStart);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].cueStart <= sorted[k - 1].cueEnd)
      errors.push(`S${String(sorted[k - 1].i + 1).padStart(2, "0")} and S${String(sorted[k].i + 1).padStart(2, "0")} overlap`);
  }
  return { rows, totalSeconds: total, ok: errors.length === 0, errors };
}

/** Human/Claude-readable report, same shape as the check script used in the original workflow. */
export function formatCheck(r: CheckResult, src: SourceSequence): string {
  const lines = r.rows.map(
    (x) =>
      `S${String(x.index).padStart(2, "0")} ${x.theme.padEnd(14)} ${x.cueStart}-${x.cueEnd} ${x.seconds.toFixed(1).padStart(5)}s  ${framesToTc(x.f0, src.rate)}${x.error ? `  !! ${x.error}` : ""}`,
  );
  lines.push(`TOTAL ${secToMinSec(r.totalSeconds)} (${Math.round(r.totalSeconds)}s) ${r.ok ? "OK" : "FIX: " + r.errors.join("; ")}`);
  return lines.join("\n");
}
