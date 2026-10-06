/**
 * Reads a Premiere / FCP7 xmeml (v4) interview sequence: the camera clips on
 * V1, the dialogue audio clips, the full <file> definitions (so we can re-embed
 * them and Premiere relinks to the same media), and the video <format>.
 */
import { DOMParser, XMLSerializer, type Element as XElement } from "@xmldom/xmldom";
import { DEFAULT_RATE, type Rate } from "./timecode.js";

export interface SourceClip {
  name: string;
  start: number; // sequence frames
  end: number;
  in: number; // source frames
  duration: number; // source media duration in frames
  fileId: string;
  sourceTrack?: number;
}

export interface AudioLayout {
  /** How the dialogue audio is laid out in the source sequence. */
  kind: "external" | "camera";
  /** One entry per mono channel we will carry into the selects sequence. */
  sourceTracks: number[];
  /** Clips from the first dialogue track; used to map timecode to source. */
  clips: SourceClip[];
}

export interface SourceSequence {
  name: string;
  rate: Rate;
  video: SourceClip[];
  audio: AudioLayout;
  /** Full <file> elements (serialized) keyed by id. */
  files: Map<string, string>;
  /** Serialized video <format> element, copied into the output sequence. */
  formatXml: string;
  width?: number;
  height?: number;
}

const kids = (el: XElement | null | undefined, tag: string): XElement[] =>
  el ? (Array.from(el.childNodes).filter((n) => (n as XElement).tagName === tag) as XElement[]) : [];
const kid = (el: XElement | null | undefined, tag: string) => kids(el, tag)[0] ?? null;
const txt = (el: XElement | null | undefined, path: string): string | null => {
  let cur: XElement | null | undefined = el;
  for (const p of path.split("/")) cur = kid(cur, p);
  return cur?.textContent ?? null;
};
const num = (el: XElement, path: string) => {
  const v = txt(el, path);
  if (v == null) throw new Error(`Missing <${path}> in clipitem`);
  return parseInt(v, 10);
};

function readClip(c: XElement): SourceClip {
  const file = kid(c, "file");
  if (!file) throw new Error("clipitem without <file>");
  const st = txt(c, "sourcetrack/trackindex");
  return {
    name: txt(c, "name") ?? "",
    start: num(c, "start"),
    end: num(c, "end"),
    in: num(c, "in"),
    duration: num(c, "duration"),
    fileId: file.getAttribute("id") ?? "",
    sourceTrack: st ? parseInt(st, 10) : undefined,
  };
}

const isWav = (name: string) => /\.(wav|bwf|aif|aiff)$/i.test(name);

export function parsePremiereXml(xml: string): SourceSequence {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement as unknown as XElement;
  const seq = kid(root, "sequence") ?? (root.getElementsByTagName("sequence")[0] as unknown as XElement);
  if (!seq) throw new Error("No <sequence> found — is this a Premiere XML (xmeml) export?");

  const ser = new XMLSerializer();
  const files = new Map<string, string>();
  const allFiles = seq.getElementsByTagName("file");
  for (let i = 0; i < allFiles.length; i++) {
    const f = allFiles[i] as unknown as XElement;
    if (kid(f, "pathurl") && f.getAttribute("id")) files.set(f.getAttribute("id")!, ser.serializeToString(f as never));
  }

  const rateEl = kid(seq, "rate");
  const rate: Rate = rateEl
    ? { timebase: parseInt(txt(rateEl, "timebase") ?? "24", 10), ntsc: (txt(rateEl, "ntsc") ?? "TRUE").toUpperCase() === "TRUE" }
    : DEFAULT_RATE;

  const media = kid(seq, "media");
  const videoEl = kid(media, "video");
  const audioEl = kid(media, "audio");
  const vTracks = kids(videoEl, "track");
  if (!vTracks.length) throw new Error("Sequence has no video tracks");
  const video = kids(vTracks[0], "clipitem").map(readClip).filter((c) => c.start >= 0);

  // Dialogue audio: prefer external recorder WAV tracks (lav), else camera audio.
  const aTracks = kids(audioEl, "track").map((t) => kids(t, "clipitem").map(readClip).filter((c) => c.start >= 0));
  const wavTracks = aTracks.filter((cs) => cs.length && isWav(cs[0].name));
  const pool = wavTracks.length ? wavTracks : aTracks.filter((cs) => cs.length);
  if (!pool.length) throw new Error("Sequence has no audio clips");
  const firstFile = pool[0][0].fileId;
  const sameSource = pool.filter((cs) => cs[0].fileId === firstFile);
  const sourceTracks = [...new Set(sameSource.map((cs) => cs[0].sourceTrack ?? 1))].sort((a, b) => a - b);
  const primary = sameSource.find((cs) => (cs[0].sourceTrack ?? 1) === sourceTracks[0])!;

  const fmt = kid(videoEl, "format");
  const w = txt(fmt, "samplecharacteristics/width");
  const h = txt(fmt, "samplecharacteristics/height");

  return {
    name: txt(seq, "name") ?? "",
    rate,
    video,
    audio: { kind: wavTracks.length ? "external" : "camera", sourceTracks, clips: primary },
    files,
    formatXml: fmt ? ser.serializeToString(fmt as never) : "",
    width: w ? parseInt(w, 10) : undefined,
    height: h ? parseInt(h, 10) : undefined,
  };
}

/** Find the clip that fully contains [f0, f1] in sequence frames. */
export function clipFor(clips: SourceClip[], f0: number, f1: number): SourceClip | null {
  return clips.find((c) => c.start <= f0 && f1 <= c.end) ?? null;
}
