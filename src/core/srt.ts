export interface Cue {
  /** SRT index as written in the file (1-based, used as the stable id everywhere). */
  n: number;
  start: number; // seconds
  end: number; // seconds
  text: string;
}

function ts(s: string): number {
  const m = s.trim().match(/^(\d+):(\d+):(\d+)[,.](\d+)$/);
  if (!m) throw new Error(`Bad SRT timestamp: ${s}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, "0").slice(0, 3) / 1000;
}

export function parseSrt(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const n = parseInt(lines[0], 10);
    const arrow = lines[1].split("-->");
    if (Number.isNaN(n) || arrow.length !== 2) continue;
    cues.push({
      n,
      start: ts(arrow[0]),
      end: ts(arrow[1]),
      text: lines.slice(2).map((l) => l.trim()).join(" "),
    });
  }
  return cues;
}

export function cueMap(cues: Cue[]): Map<number, Cue> {
  return new Map(cues.map((c) => [c.n, c]));
}

/** Text of an inclusive cue range. */
export function rangeText(cues: Map<number, Cue>, a: number, b: number): string {
  const out: string[] = [];
  for (let i = a; i <= b; i++) {
    const c = cues.get(i);
    if (c) out.push(c.text);
  }
  return out.join(" ");
}

/** Compact, cue-numbered dump for prompting Claude: "12|1:05|text". */
export function cueDump(cues: Cue[], mark?: Set<number>): string {
  return cues
    .map((c) => {
      const m = Math.floor(c.start / 60);
      const s = String(Math.floor(c.start % 60)).padStart(2, "0");
      return `${mark?.has(c.n) ? "*" : ""}${c.n}|${m}:${s}|${c.text}`;
    })
    .join("\n");
}
