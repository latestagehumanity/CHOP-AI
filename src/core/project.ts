/**
 * Project model: a set of interviews (SRT + Premiere XML pairs), the client
 * brief, and the edit settings. Pure data — persisted as chop-project.json.
 */
import type { Replacement } from "./clean.js";
import type { Select } from "./selects.js";
import { DEFAULT_THEMES } from "./selects.js";
import type { Segment } from "./transcript.js";

export type StageStatus = "pending" | "running" | "done" | "error";

export interface Interview {
  id: string;
  /** Display name, e.g. "Jane Doe" (guessed from the filename, refined by Claude). */
  name: string;
  company: string;
  srtPath: string;
  xmlPath: string;
  segments?: Segment[];
  fixes?: Replacement[];
  selects?: Select[];
  /** Claude's one-paragraph rationale for the current selects. */
  selectsSummary?: string;
  status: { analyze: StageStatus; selects: StageStatus; export: StageStatus };
  error?: string;
}

export interface ProjectSettings {
  /** Client brief, pasted verbatim. */
  brief: string;
  themes: string[];
  targetSeconds: number;
  toleranceSeconds: number;
  punchScale: number;
  punchOn: "even" | "odd" | "none";
  model: string;
  /** Optional reference edit SRT; its runtime is shown to Claude as the length/tone benchmark. */
  referenceSrtPath?: string;
  outputDir?: string;
}

export interface Project {
  version: 1;
  name: string;
  settings: ProjectSettings;
  interviews: Interview[];
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export const DEFAULT_SETTINGS: ProjectSettings = {
  brief: "",
  themes: [...DEFAULT_THEMES],
  targetSeconds: 300,
  toleranceSeconds: 15,
  punchScale: 120,
  punchOn: "even",
  model: DEFAULT_MODEL,
};

export function newProject(name: string): Project {
  return { version: 1, name, settings: { ...DEFAULT_SETTINGS }, interviews: [] };
}

/** "3f2a9c1d-JANE_DOE_INTERVIEW_V1.srt" -> "JANE_DOE_INTERVIEW_V1" */
export function baseKey(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file
    .replace(/\.[^.]+$/, "")
    .replace(/^[0-9a-f]{8}-/i, "")
    .toUpperCase();
}

/** "JANE_DOE_INTERVIEW_V1" -> "Jane Doe" */
export function guessName(key: string): string {
  const words = key
    .replace(/[_\-.]+/g, " ")
    .split(" ")
    .filter((w) => w && !/^(INTERVIEW|V\d+|FINAL|SELECTS|TRANSCRIPT|\d+)$/i.test(w));
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** Pair SRTs with XMLs by filename. Returns pairs plus anything left unmatched. */
export function pairFiles(paths: string[]): { pairs: { key: string; srt: string; xml: string }[]; unmatched: string[] } {
  const srts = new Map<string, string>();
  const xmls = new Map<string, string>();
  for (const p of paths) {
    if (/\.srt$/i.test(p)) srts.set(baseKey(p), p);
    else if (/\.xml$/i.test(p)) xmls.set(baseKey(p), p);
  }
  const pairs: { key: string; srt: string; xml: string }[] = [];
  const unmatched: string[] = [];
  for (const [k, srt] of srts) {
    const xml = xmls.get(k);
    if (xml) {
      pairs.push({ key: k, srt, xml });
      xmls.delete(k);
    } else unmatched.push(srt);
  }
  unmatched.push(...xmls.values());
  return { pairs: pairs.sort((a, b) => a.key.localeCompare(b.key)), unmatched };
}

export function interviewFromPair(pair: { key: string; srt: string; xml: string }): Interview {
  return {
    id: pair.key,
    name: guessName(pair.key),
    company: "",
    srtPath: pair.srt,
    xmlPath: pair.xml,
    status: { analyze: "pending", selects: "pending", export: "pending" },
  };
}

/** Output filename stem: JANE_DOE_INTERVIEW_V1 -> JANE_DOE_SELECTS_V1 */
export function selectsStem(id: string, version = 1): string {
  const stem = id.replace(/_?INTERVIEW(_V\d+)?$/i, "");
  return `${stem}_SELECTS_V${version}`;
}
