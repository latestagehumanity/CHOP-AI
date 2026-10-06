/**
 * Builds a Premiere-importable xmeml v4 selects sequence: the chosen
 * soundbites butt-joined from 00:00:00:00, video on V1 with a Basic Motion
 * scale that alternates wide / punch-in on every cut (so jump cuts read as a
 * deliberate reframe), dialogue audio as linked mono tracks, and a sequence
 * marker per select carrying its text.
 */
import type { Cue } from "./srt.js";
import { clipFor, type SourceSequence } from "./premiere.js";
import type { Select } from "./selects.js";
import { secToFrames, type Rate } from "./timecode.js";

export interface XmlOptions {
  sequenceName: string;
  /** Scale (percent) for punch-in clips. 100 = no punch. */
  punchScale: number;
  /** Which clips get the punch: "even" (S02, S04 …), "odd", or "none". */
  punchOn: "even" | "odd" | "none";
  /** Basic Motion center for punched clips, in Premiere's -1..1 normalised units. */
  punchCenter: { horiz: number; vert: number };
}

export const DEFAULT_XML_OPTIONS: Omit<XmlOptions, "sequenceName"> = {
  punchScale: 120,
  punchOn: "even",
  punchCenter: { horiz: 0, vert: 0 },
};

export interface PlacedSelect {
  n: number;
  select: Select;
  label: string;
  srcIn: number; // sequence frames in the source interview sequence
  srcOut: number;
  recIn: number; // frames in the new selects sequence
  recOut: number;
  scale: number;
  text: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rateXml = (r: Rate) => `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;

function motion(scale: number, c: { horiz: number; vert: number }): string {
  return (
    `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory>` +
    `<effecttype>motion</effecttype><mediatype>video</mediatype>` +
    `<parameter authoringApp="PremierePro"><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>10000</valuemax><value>${scale}</value></parameter>` +
    `<parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>${c.horiz}</horiz><vert>${c.vert}</vert></value></parameter>` +
    `</effect></filter>`
  );
}

export function placeSelects(
  selects: Select[],
  cues: Map<number, Cue>,
  src: SourceSequence,
  opts: Omit<XmlOptions, "sequenceName">,
): PlacedSelect[] {
  let rec = 0;
  return selects.map((s, i) => {
    const n = i + 1;
    const a = cues.get(s.cueStart);
    const b = cues.get(s.cueEnd);
    if (!a || !b) throw new Error(`S${n}: cue ${!a ? s.cueStart : s.cueEnd} not found`);
    const f0 = secToFrames(a.start, src.rate);
    const f1 = secToFrames(b.end, src.rate);
    const punched = opts.punchOn === "none" ? false : opts.punchOn === "even" ? n % 2 === 0 : n % 2 === 1;
    const text: string[] = [];
    for (let k = s.cueStart; k <= s.cueEnd; k++) if (cues.get(k)) text.push(cues.get(k)!.text);
    const p: PlacedSelect = {
      n,
      select: s,
      label: `S${String(n).padStart(2, "0")} ${s.theme}`,
      srcIn: f0,
      srcOut: f1,
      recIn: rec,
      recOut: rec + (f1 - f0),
      scale: punched ? opts.punchScale : 100,
      text: s.line ?? text.join(" "),
    };
    rec = p.recOut;
    return p;
  });
}

export function buildSelectsXml(
  selects: Select[],
  cues: Map<number, Cue>,
  src: SourceSequence,
  options: XmlOptions,
): { xml: string; placed: PlacedSelect[]; totalFrames: number } {
  const placed = placeSelects(selects, cues, src, options);
  const R = rateXml(src.rate);
  const nA = src.audio.sourceTracks.length;
  const used = new Set<string>();
  const fileRef = (id: string) => {
    if (used.has(id)) return `<file id="${esc(id)}"/>`;
    used.add(id);
    const full = src.files.get(id);
    if (!full) throw new Error(`No <file> definition for ${id} in source XML`);
    return full;
  };

  const vItems: string[] = [];
  const aItems: string[][] = Array.from({ length: nA }, () => []);
  const markers: string[] = [];

  for (const p of placed) {
    const L = p.srcOut - p.srcIn;
    const vc = clipFor(src.video, p.srcIn, p.srcOut);
    const ac = clipFor(src.audio.clips, p.srcIn, p.srcOut);
    if (!vc) throw new Error(`${p.label} crosses a camera clip boundary`);
    if (!ac) throw new Error(`${p.label} crosses an audio clip boundary`);
    const vin = vc.in + p.srcIn - vc.start;
    const ain = ac.in + p.srcIn - ac.start;
    const vid = `clipitem-v${p.n}`;
    const aids = src.audio.sourceTracks.map((_, k) => `clipitem-a${p.n}-${k + 1}`);
    const links =
      `<link><linkclipref>${vid}</linkclipref><mediatype>video</mediatype><trackindex>1</trackindex><clipindex>${p.n}</clipindex></link>` +
      aids
        .map((id, k) => `<link><linkclipref>${id}</linkclipref><mediatype>audio</mediatype><trackindex>${k + 1}</trackindex><clipindex>${p.n}</clipindex></link>`)
        .join("");
    const name = esc(p.label);
    vItems.push(
      `<clipitem id="${vid}"><name>${name}</name><enabled>TRUE</enabled><duration>${vc.duration}</duration>${R}` +
        `<start>${p.recIn}</start><end>${p.recOut}</end><in>${vin}</in><out>${vin + L}</out>` +
        `<alphatype>none</alphatype><pixelaspectratio>square</pixelaspectratio><anamorphic>FALSE</anamorphic>` +
        `${fileRef(vc.fileId)}${motion(p.scale, p.scale === 100 ? { horiz: 0, vert: 0 } : options.punchCenter)}${links}</clipitem>`,
    );
    src.audio.sourceTracks.forEach((st, k) => {
      aItems[k].push(
        `<clipitem id="${aids[k]}" premiereChannelType="mono"><name>${name}</name><enabled>TRUE</enabled><duration>${ac.duration}</duration>${R}` +
          `<start>${p.recIn}</start><end>${p.recOut}</end><in>${ain}</in><out>${ain + L}</out>${fileRef(ac.fileId)}` +
          `<sourcetrack><mediatype>audio</mediatype><trackindex>${st}</trackindex></sourcetrack>${links}</clipitem>`,
      );
    });
    markers.push(`<marker><name>${name}</name><comment>${esc(p.text.slice(0, 200))}</comment><in>${p.recIn}</in><out>-1</out></marker>`);
  }

  const total = placed.length ? placed[placed.length - 1].recOut : 0;
  const vTrack = `<track>${vItems.join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
  const aTracks = aItems
    .map((items, k) => `<track>${items.join("")}<enabled>TRUE</enabled><locked>FALSE</locked><outputchannelindex>${(k % 2) + 1}</outputchannelindex></track>`)
    .join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n` +
    `<xmeml version="4"><sequence id="sequence-selects"><name>${esc(options.sequenceName)}</name><duration>${total}</duration>${R}\n` +
    `<media><video>${src.formatXml}${vTrack}</video>\n` +
    `<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>\n` +
    `<outputs><group><index>1</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>1</index></channel></group>` +
    `<group><index>2</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>2</index></channel></group></outputs>\n` +
    `${aTracks}</audio></media>\n` +
    `<timecode>${R}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>\n` +
    `${markers.join("")}</sequence></xmeml>`;
  return { xml, placed, totalFrames: total };
}
