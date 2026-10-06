/**
 * Paper edit export: one table per interviewee, in cut order, with sequence
 * timecodes that match the generated Premiere XML.
 */
import type { PlacedSelect } from "./xmlgen.js";
import { framesToSec, framesToTc, secToMinSec, type Rate } from "./timecode.js";

export interface PaperEditEntry {
  name: string;
  company: string;
  xmlFile: string;
  rate: Rate;
  placed: PlacedSelect[];
  totalFrames: number;
}

export interface PaperEditDocOptions {
  title: string;
  /** Free-text intro, e.g. approach and gaps. Plain text; paragraphs split on blank lines. */
  intro?: string;
  punchScale: number;
}

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function paperEditHtml(entries: PaperEditEntry[], o: PaperEditDocOptions): string {
  const out: string[] = [`<h1>${h(o.title)}</h1>`];
  if (o.intro) for (const p of o.intro.split(/\n\s*\n/)) out.push(`<p>${h(p.trim())}</p>`);
  out.push(
    `<p><b>How to read this</b></p><ul>` +
      `<li>Selects are listed in the proposed cut order, which is not always the order they were filmed.</li>` +
      `<li>Source in / out is the Premiere sequence timecode of each interview.</li>` +
      `<li>Frame: cuts alternate between the wide shot (100%) and a punch-in (${o.punchScale}%) so every jump cut is covered by a change in framing.</li>` +
      `<li>Lines are clean verbatim from the auto-transcript. Check names against audio before using a line on screen.</li></ul>`,
  );
  for (const e of entries) {
    const total = framesToSec(e.totalFrames, e.rate);
    out.push(`<h2>${h(e.name)}${e.company ? `, ${h(e.company)}` : ""}</h2><p>Assembly runtime ${secToMinSec(total)} · ${e.placed.length} selects · XML: <b>${h(e.xmlFile)}</b></p>`);
    out.push(
      `<table border='1' cellpadding='4' style='border-collapse:collapse'><tr><td><b>#</b></td><td><b>Theme</b></td><td><b>Source in / out</b></td><td><b>Dur</b></td><td><b>Frame</b></td><td><b>Line</b></td></tr>`,
    );
    for (const p of e.placed) {
      out.push(
        `<tr><td>S${String(p.n).padStart(2, "0")}</td><td>${h(p.select.theme)}</td><td>${framesToTc(p.srcIn, e.rate)}<br>${framesToTc(p.srcOut, e.rate)}</td>` +
          `<td>${framesToSec(p.srcOut - p.srcIn, e.rate).toFixed(1)}s</td><td>${p.scale === 100 ? "Wide" : "Punch"}</td><td>${h(p.text)}</td></tr>`,
      );
    }
    out.push(`</table>`);
  }
  return `<html><head><meta charset="utf-8"><title>${h(o.title)}</title></head><body style="font-family:Arial">${out.join("\n")}</body></html>`;
}

export function paperEditCsv(entries: PaperEditEntry[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [["Interviewee", "#", "Theme", "Source in", "Source out", "Duration (s)", "Frame", "Line"].join(",")];
  for (const e of entries)
    for (const p of e.placed)
      rows.push(
        [q(e.name), `S${String(p.n).padStart(2, "0")}`, q(p.select.theme), framesToTc(p.srcIn, e.rate), framesToTc(p.srcOut, e.rate),
          framesToSec(p.srcOut - p.srcIn, e.rate).toFixed(1), p.scale === 100 ? "Wide" : "Punch", q(p.text)].join(","),
      );
  return rows.join("\n");
}
