/**
 * Client-readable transcript: numbered interviewer questions as headings, a
 * blank line, then the answer in short timecoded paragraphs. Off-camera
 * setup / resets ("x" segments) are dropped entirely.
 */
import type { Cue } from "./srt.js";
import { cleanVerbatim, type Replacement } from "./clean.js";
import { secToClock } from "./timecode.js";

export type Role = "q" | "a" | "x";

/** A segment starts at `startCue` and runs until the next segment starts. */
export interface Segment {
  startCue: number;
  role: Role;
}

export interface TranscriptMeta {
  name: string;
  company: string;
  sourceFile?: string;
}

export interface TranscriptBlock {
  kind: "question" | "paragraph";
  qNumber?: number;
  time: number; // seconds
  text: string;
}

export function buildTranscript(cues: Cue[], segments: Segment[], fixes: Replacement[] = []): TranscriptBlock[] {
  const segs = [...segments].sort((a, b) => a.startCue - b.startCue);
  const out: TranscriptBlock[] = [];
  let q = 0;
  segs.forEach((seg, i) => {
    const endCue = i + 1 < segs.length ? segs[i + 1].startCue - 1 : Infinity;
    const ids = cues.filter((c) => c.n >= seg.startCue && c.n <= endCue);
    if (!ids.length || seg.role === "x") return;
    if (seg.role === "q") {
      q++;
      out.push({ kind: "question", qNumber: q, time: ids[0].start, text: cleanVerbatim(ids.map((c) => c.text).join(" "), fixes) });
      return;
    }
    // answers: break into ~40-65 word paragraphs on sentence (or clause) ends
    let cur: string[] = [];
    let t0: number | null = null;
    let wc = 0;
    const flush = () => {
      if (cur.length) out.push({ kind: "paragraph", time: t0!, text: cleanVerbatim(cur.join(" "), fixes) });
      cur = [];
      t0 = null;
      wc = 0;
    };
    for (const c of ids) {
      if (t0 === null) t0 = c.start;
      cur.push(c.text);
      wc += c.text.split(/\s+/).length;
      if ((wc >= 38 && /[.?!]$/.test(c.text)) || (wc >= 65 && /,$/.test(c.text))) flush();
    }
    flush();
  });
  return out;
}

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const NOTE = `<p><b>How to read this</b></p><ul>
<li>Each interviewer question is a numbered heading with its timecode. The interviewer is off camera and will be cut.</li>
<li>Answers are split into short paragraphs, each starting with its timecode.</li>
<li>Setup, resets and off-camera chat are left out.</li>
<li>Clean verbatim from automatic transcription: stutters and filler removed, wording otherwise unchanged. Check names against audio before putting a line on screen.</li>
</ul>`;

/** HTML laid out to convert cleanly into a Google Doc / Word document. */
export function transcriptHtml(blocks: TranscriptBlock[], meta: TranscriptMeta, runtimeSec: number): string {
  const body = [
    `<h1>${h(meta.name)}</h1><p><b>${h(meta.company)}</b> · Runtime ${secToClock(runtimeSec)}${meta.sourceFile ? ` · <font color="#999999">${h(meta.sourceFile)}</font>` : ""}</p>`,
    NOTE,
  ];
  for (const b of blocks) {
    if (b.kind === "question")
      body.push(`<h3>Q${b.qNumber} · ${secToClock(b.time)}</h3><p><i><font color="#555555">${h(b.text)}</font></i></p><p>&nbsp;</p>`);
    else body.push(`<p><font color="#999999">${secToClock(b.time)}</font>&nbsp;&nbsp;${h(b.text)}</p>`);
  }
  return `<html><head><meta charset="utf-8"><title>${h(meta.name)} – Transcript</title></head><body style="font-family:Arial">${body.join("\n")}</body></html>`;
}

export function transcriptMarkdown(blocks: TranscriptBlock[], meta: TranscriptMeta, runtimeSec: number): string {
  const lines = [`# ${meta.name}`, ``, `**${meta.company}** · Runtime ${secToClock(runtimeSec)}`, ``];
  for (const b of blocks) {
    if (b.kind === "question") lines.push(`### Q${b.qNumber} · ${secToClock(b.time)}`, ``, `*${b.text}*`, ``, ``);
    else lines.push(`\`${secToClock(b.time)}\` ${b.text}`, ``);
  }
  return lines.join("\n");
}
