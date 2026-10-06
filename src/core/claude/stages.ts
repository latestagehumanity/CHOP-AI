/**
 * The three Claude stages of the Chop pipeline:
 *  1. analyzeInterview – who is speaking when (interviewer Q / interviewee A /
 *     off-camera setup), the interviewee's name + company, and corrections for
 *     misheard names.
 *  2. pickSelects – choose and order soundbites to hit a target runtime, using
 *     a local check_selects tool for exact durations and clip-boundary checks.
 *  3. cleanLines – clean-verbatim text for each select, for the paper edit.
 */
import type { Cue } from "../srt.js";
import { cueDump, cueMap } from "../srt.js";
import type { Replacement } from "../clean.js";
import type { SourceSequence } from "../premiere.js";
import { checkSelects, formatCheck, type Select } from "../selects.js";
import { secToMinSec } from "../timecode.js";
import type { Segment } from "../transcript.js";
import { Claude, type Tool } from "./client.js";

/* ------------------------------------------------------------------ */
/* 1. Analyze                                                          */
/* ------------------------------------------------------------------ */

export interface Analysis {
  interviewee_name: string;
  company: string;
  segments: { start_cue: number; role: "q" | "a" | "x" }[];
  fixes: { find: string; replace: string }[];
}

const ANALYZE_TOOL: Tool = {
  name: "submit_analysis",
  description: "Submit the speaker segmentation and transcript corrections for this interview.",
  input_schema: {
    type: "object",
    properties: {
      interviewee_name: { type: "string", description: "Full name of the on-camera interviewee." },
      company: { type: "string", description: "Their company, as it should be spelled." },
      segments: {
        type: "array",
        description:
          "Ordered segments covering the whole transcript. Each runs from start_cue until the next segment's start_cue. " +
          "q = interviewer question (off camera), a = interviewee answer, x = setup, slate, resets, crew chat, or false starts to drop.",
        items: {
          type: "object",
          properties: { start_cue: { type: "integer" }, role: { type: "string", enum: ["q", "a", "x"] } },
          required: ["start_cue", "role"],
        },
      },
      fixes: {
        type: "array",
        description:
          "Literal find/replace corrections for words the auto-transcriber misheard (company/product/people names, e.g. 'inside' -> 'Insight' when the investor is meant). " +
          "Only fix clear mishearings. Never reword, summarise or add content. Make `find` specific enough not to hit correct uses.",
        items: {
          type: "object",
          properties: { find: { type: "string" }, replace: { type: "string" } },
          required: ["find", "replace"],
        },
      },
    },
    required: ["interviewee_name", "company", "segments", "fixes"],
  },
};

export async function analyzeInterview(
  claude: Claude,
  cues: Cue[],
  ctx: { filenameName: string; brief: string },
): Promise<{ name: string; company: string; segments: Segment[]; fixes: Replacement[] }> {
  claude.log(`Analyzing ${ctx.filenameName} (${cues.length} cues)…`);
  const system = Claude.system(
    "You are an assistant editor on a talking-head interview edit. You read auto-generated SRT transcripts and work out who is speaking. " +
      "The interviewer is off camera; the interviewee is on camera. Transcripts often start with setup chat, mic checks and briefing before the first real question, and questions are sometimes re-asked after a reset.",
    `Client brief (for context on names and companies):\n${ctx.brief || "(none)"}`,
    `Transcript of the interview with ${ctx.filenameName}. Format: cue|m:ss|text\n\n${cueDump(cues)}`,
  );
  const a = await claude.structured<Analysis>(
    system,
    "Segment the full transcript into q / a / x segments and list corrections for misheard names. Use the cue numbers exactly as given.",
    ANALYZE_TOOL,
  );
  const valid = new Set(cues.map((c) => c.n));
  const segments = a.segments
    .filter((s) => valid.has(s.start_cue))
    .map((s) => ({ startCue: s.start_cue, role: s.role }))
    .sort((x, y) => x.startCue - y.startCue);
  return {
    name: a.interviewee_name || ctx.filenameName,
    company: a.company,
    segments,
    fixes: a.fixes.filter((f) => f.find && f.find !== f.replace).map((f) => ({ find: f.find, replace: f.replace })),
  };
}

/* ------------------------------------------------------------------ */
/* 2. Pick selects                                                     */
/* ------------------------------------------------------------------ */

const SELECT_ITEM = {
  type: "object",
  properties: {
    theme: { type: "string" },
    cue_start: { type: "integer" },
    cue_end: { type: "integer" },
    note: { type: "string", description: "One line: what this bite adds to the story." },
  },
  required: ["theme", "cue_start", "cue_end"],
} as const;

const CHECK_TOOL: Tool = {
  name: "check_selects",
  description:
    "Check a candidate cut. Returns each select's exact duration, the total runtime, and errors (missing cues, overlaps, ranges crossing a camera/audio clip boundary). Call this as often as you like.",
  input_schema: { type: "object", properties: { selects: { type: "array", items: SELECT_ITEM } }, required: ["selects"] },
};

const SUBMIT_TOOL: Tool = {
  name: "submit_selects",
  description: "Submit the final cut. It must pass check_selects with no errors and land inside the target runtime range.",
  input_schema: {
    type: "object",
    properties: {
      selects: { type: "array", items: SELECT_ITEM },
      summary: { type: "string", description: "2-4 sentences for the editor: the story arc, and anything to check on audio." },
    },
    required: ["selects", "summary"],
  },
};

type RawSelect = { theme: string; cue_start: number; cue_end: number; note?: string };
const toSelects = (xs: RawSelect[]): Select[] =>
  xs.map((x) => ({ theme: x.theme, cueStart: x.cue_start, cueEnd: x.cue_end, note: x.note }));

export interface PickParams {
  name: string;
  company: string;
  brief: string;
  themes: string[];
  targetSeconds: number;
  toleranceSeconds: number;
  referenceSeconds?: number;
  /** Existing cut to revise, plus the editor's notes. */
  current?: Select[];
  feedback?: string;
}

export function selectsSystemPrompt(p: PickParams): string {
  return [
    `You are a senior documentary editor building a paper edit (an ordered list of soundbites) from one interview with ${p.name}${p.company ? ` of ${p.company}` : ""}.`,
    ``,
    `CLIENT BRIEF (follow it closely):`,
    p.brief || "(no brief supplied — favour answers that make the interviewee sound smart, visionary and forward-looking; avoid sales pitch)",
    ``,
    `THEME LABELS to use: ${p.themes.map((t) => `"${t}"`).join(", ")}.`,
    ``,
    `TARGET RUNTIME: ${secToMinSec(p.targetSeconds)} (acceptable ${secToMinSec(p.targetSeconds - p.toleranceSeconds)}–${secToMinSec(p.targetSeconds + p.toleranceSeconds)}).` +
      (p.referenceSeconds ? ` The client's reference edit runs ${secToMinSec(p.referenceSeconds)}.` : ""),
    ``,
    `CRAFT RULES`,
    `- A select is one inclusive cue range. Never include interviewer speech (cues marked Q>) or off-camera setup (X>).`,
    `- Each select must start and end on a complete thought — no dangling half-sentences, false starts, or trailing "and…".`,
    `- Jump cuts are covered by alternating wide / punch-in framing, so trimming inside an answer into several selects is fine and encouraged to remove waffle.`,
    `- Prefer fuller passages over many 2–4 second fragments; the cut should not feel choppy.`,
    `- Do not pick answers that are product pitches, feature lists or jargon-heavy; pick the ones that are thoughtful about the space and the opportunity.`,
    `- Order the selects as a story, not in filmed order: open with who they are / what the company does, then why it exists and the gap, then vision, then founder lessons, and end on the partnership with a strong closing line.`,
    `- Selects must not overlap. Use check_selects to get exact durations and to catch ranges that cross a camera clip boundary (split those).`,
    `- Iterate with check_selects until the total is inside the target range, then call submit_selects.`,
  ].join("\n");
}

function roleMarkedDump(cues: Cue[], segments: Segment[] | undefined, current?: Select[]): string {
  const role = new Map<number, string>();
  if (segments?.length) {
    const segs = [...segments].sort((a, b) => a.startCue - b.startCue);
    segs.forEach((s, i) => {
      const end = i + 1 < segs.length ? segs[i + 1].startCue - 1 : Infinity;
      for (const c of cues) if (c.n >= s.startCue && c.n <= end) role.set(c.n, s.role);
    });
  }
  const inCut = new Set<number>();
  for (const s of current ?? []) for (let i = s.cueStart; i <= s.cueEnd; i++) inCut.add(i);
  return cues
    .map((c) => {
      const r = role.get(c.n);
      const tag = r === "q" ? "Q>" : r === "x" ? "X>" : "";
      const m = `${Math.floor(c.start / 60)}:${String(Math.floor(c.start % 60)).padStart(2, "0")}`;
      return `${inCut.has(c.n) ? "*" : ""}${tag}${c.n}|${m}|${c.text}`;
    })
    .join("\n");
}

export async function pickSelects(
  claude: Claude,
  cues: Cue[],
  segments: Segment[] | undefined,
  src: SourceSequence,
  p: PickParams,
): Promise<{ selects: Select[]; summary: string; report: string }> {
  const map = cueMap(cues);
  const lo = p.targetSeconds - p.toleranceSeconds;
  const hi = p.targetSeconds + p.toleranceSeconds;
  const system = Claude.system(
    selectsSystemPrompt(p),
    `TRANSCRIPT. Format: [*]?[Q>|X>]?cue|m:ss|text. A leading * marks cues already in the current cut.\n\n${roleMarkedDump(cues, segments, p.current)}`,
  );
  const user = p.current?.length
    ? `Here is the current cut:\n${JSON.stringify(p.current.map((s) => ({ theme: s.theme, cue_start: s.cueStart, cue_end: s.cueEnd })))}\n\n` +
      `Editor's notes for this revision:\n${p.feedback || "(none — improve it against the brief and target)"}\n\nRevise the cut accordingly.`
    : `Build the cut.`;

  claude.log(`Picking selects for ${p.name} (target ${secToMinSec(p.targetSeconds)})…`);
  const result = await claude.loop<{ selects: Select[]; summary: string; report: string }>({
    system,
    user,
    tools: [CHECK_TOOL, SUBMIT_TOOL],
    maxTurns: 16,
    handlers: {
      check_selects: async (input) => {
        const sel = toSelects((input as { selects: RawSelect[] }).selects ?? []);
        const r = checkSelects(sel, map, src);
        claude.log(`  check: ${sel.length} selects, ${secToMinSec(r.totalSeconds)}${r.ok ? "" : " (errors)"}`);
        return formatCheck(r, src);
      },
      submit_selects: async (input) => {
        const { selects, summary } = input as { selects: RawSelect[]; summary: string };
        const sel = toSelects(selects ?? []);
        const r = checkSelects(sel, map, src);
        const report = formatCheck(r, src);
        if (!r.ok) return { error: `Not accepted — fix these first:\n${report}` };
        if (r.totalSeconds < lo || r.totalSeconds > hi)
          return { error: `Not accepted — total ${secToMinSec(r.totalSeconds)} is outside ${secToMinSec(lo)}–${secToMinSec(hi)}.\n${report}` };
        claude.log(`  submitted ${sel.length} selects, ${secToMinSec(r.totalSeconds)}`);
        return { done: { selects: sel, summary: summary ?? "", report } };
      },
    },
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* 3. Clean lines for the paper edit                                   */
/* ------------------------------------------------------------------ */

const LINES_TOOL: Tool = {
  name: "submit_lines",
  description: "Submit one cleaned line per select, in the same order.",
  input_schema: {
    type: "object",
    properties: { lines: { type: "array", items: { type: "string" } } },
    required: ["lines"],
  },
};

export async function cleanLines(
  claude: Claude,
  raw: string[],
  ctx: { name: string; company: string; fixes: Replacement[] },
): Promise<string[]> {
  if (!raw.length) return [];
  claude.log(`Cleaning ${raw.length} lines for ${ctx.name}…`);
  const system = Claude.system(
    `You prepare soundbite text for a client-facing paper edit. Speaker: ${ctx.name}${ctx.company ? `, ${ctx.company}` : ""}. ` +
      `Known corrections: ${ctx.fixes.map((f) => `"${f.find}"→"${f.replace}"`).join("; ") || "none"}.\n\n` +
      `Rules: clean verbatim only. Remove stutters, repeated words, filler (um, uh, you know, like-as-filler) and obvious transcription garbage; ` +
      `fix clear mishearings and punctuation. Keep the speaker's own words and order — never paraphrase, summarise, or add facts. ` +
      `If a phrase is garbled and you cannot be sure what was said, keep your best reading and append " [check audio]".`,
  );
  const out = await claude.structured<{ lines: string[] }>(
    system,
    raw.map((t, i) => `${i + 1}. ${t}`).join("\n\n"),
    LINES_TOOL,
  );
  if (out.lines.length !== raw.length) throw new Error(`Expected ${raw.length} lines, got ${out.lines.length}`);
  return out.lines;
}
