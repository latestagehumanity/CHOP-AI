/**
 * Orchestration shared by the desktop app and the CLI. Everything that
 * touches the filesystem or Claude lives here; the modules it calls are pure.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSrt, cueMap, rangeText, type Cue } from "./srt.js";
import { parsePremiereXml, type SourceSequence } from "./premiere.js";
import { cleanVerbatim } from "./clean.js";
import { buildTranscript, transcriptHtml, transcriptMarkdown } from "./transcript.js";
import { buildSelectsXml } from "./xmlgen.js";
import { paperEditCsv, paperEditHtml, type PaperEditEntry } from "./paperedit.js";
import { checkSelects } from "./selects.js";
import { interviewFromPair, pairFiles, selectsStem, type Interview, type Project } from "./project.js";
import { Claude } from "./claude/client.js";
import { analyzeInterview, cleanLines, pickSelects } from "./claude/stages.js";

export interface LoadedInterview {
  cues: Cue[];
  source: SourceSequence;
}

const cache = new Map<string, LoadedInterview>();

export async function loadInterview(iv: Interview): Promise<LoadedInterview> {
  const key = `${iv.srtPath}|${iv.xmlPath}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [srt, xml] = await Promise.all([readFile(iv.srtPath, "utf8"), readFile(iv.xmlPath, "utf8")]);
  const loaded = { cues: parseSrt(srt), source: parsePremiereXml(xml) };
  cache.set(key, loaded);
  return loaded;
}

export async function srtRuntime(path: string): Promise<number> {
  const cues = parseSrt(await readFile(path, "utf8"));
  return cues.length ? cues[cues.length - 1].end : 0;
}

export function addFiles(project: Project, paths: string[]): { added: Interview[]; unmatched: string[] } {
  const { pairs, unmatched } = pairFiles(paths);
  const have = new Set(project.interviews.map((i) => i.id));
  const added = pairs.filter((p) => !have.has(p.key)).map(interviewFromPair);
  project.interviews.push(...added);
  return { added, unmatched };
}

export async function saveProject(project: Project, path: string) {
  await writeFile(path, JSON.stringify(project, null, 2));
}

export async function loadProject(path: string): Promise<Project> {
  return JSON.parse(await readFile(path, "utf8")) as Project;
}

/* --------------------------------- stages -------------------------------- */

export async function runAnalyze(project: Project, iv: Interview, claude: Claude) {
  iv.status.analyze = "running";
  try {
    const { cues } = await loadInterview(iv);
    const a = await analyzeInterview(claude, cues, { filenameName: iv.name, brief: project.settings.brief });
    iv.name = a.name;
    iv.company = a.company;
    iv.segments = a.segments;
    iv.fixes = a.fixes;
    iv.status.analyze = "done";
    iv.error = undefined;
  } catch (e) {
    iv.status.analyze = "error";
    iv.error = String((e as Error).message ?? e);
    throw e;
  }
}

export async function runSelects(project: Project, iv: Interview, claude: Claude, feedback?: string) {
  iv.status.selects = "running";
  try {
    const { cues, source } = await loadInterview(iv);
    const s = project.settings;
    const referenceSeconds = s.referenceSrtPath ? await srtRuntime(s.referenceSrtPath) : undefined;
    const r = await pickSelects(claude, cues, iv.segments, source, {
      name: iv.name,
      company: iv.company,
      brief: s.brief,
      themes: s.themes,
      targetSeconds: s.targetSeconds,
      toleranceSeconds: s.toleranceSeconds,
      referenceSeconds,
      current: feedback !== undefined ? iv.selects : undefined,
      feedback,
    });
    iv.selects = r.selects;
    iv.selectsSummary = r.summary;
    iv.status.selects = "done";
    iv.error = undefined;
  } catch (e) {
    iv.status.selects = "error";
    iv.error = String((e as Error).message ?? e);
    throw e;
  }
}

/** Fill in select.line with Claude-cleaned text (falls back to the regex clean). */
export async function runCleanLines(iv: Interview, claude: Claude | null) {
  if (!iv.selects?.length) return;
  const { cues } = await loadInterview(iv);
  const map = cueMap(cues);
  const raw = iv.selects.map((s) => rangeText(map, s.cueStart, s.cueEnd));
  const lines = claude
    ? await cleanLines(claude, raw, { name: iv.name, company: iv.company, fixes: iv.fixes ?? [] })
    : raw.map((t) => cleanVerbatim(t, iv.fixes));
  iv.selects.forEach((s, i) => (s.line = lines[i]));
}

/* --------------------------------- export -------------------------------- */

export interface ExportResult {
  files: string[];
  warnings: string[];
}

export async function exportProject(project: Project, outDir: string, opts: { version?: number } = {}): Promise<ExportResult> {
  const version = opts.version ?? 1;
  const files: string[] = [];
  const warnings: string[] = [];
  const dirs = { t: join(outDir, "transcripts"), x: join(outDir, "xml"), p: join(outDir, "paper-edit") };
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
  const s = project.settings;
  const entries: PaperEditEntry[] = [];

  for (const iv of project.interviews) {
    const { cues, source } = await loadInterview(iv);
    const runtime = cues.length ? cues[cues.length - 1].end : 0;
    const meta = { name: iv.name, company: iv.company, sourceFile: iv.srtPath.split(/[\\/]/).pop() };

    // Transcript (needs segments; without them everything is treated as answer).
    if (!iv.segments?.length) warnings.push(`${iv.name}: not analyzed — transcript has no question headings`);
    const blocks = buildTranscript(cues, iv.segments?.length ? iv.segments : [{ startCue: cues[0]?.n ?? 1, role: "a" }], iv.fixes);
    const tStem = iv.id.replace(/_?INTERVIEW(_V\d+)?$/i, "") + "_TRANSCRIPT";
    for (const [ext, body] of [
      ["html", transcriptHtml(blocks, meta, runtime)],
      ["md", transcriptMarkdown(blocks, meta, runtime)],
    ] as const) {
      const f = join(dirs.t, `${tStem}.${ext}`);
      await writeFile(f, body);
      files.push(f);
    }

    // Selects XML + paper edit entry.
    if (!iv.selects?.length) {
      warnings.push(`${iv.name}: no selects yet — skipped XML and paper edit`);
      continue;
    }
    const check = checkSelects(iv.selects, cueMap(cues), source);
    if (!check.ok) {
      warnings.push(`${iv.name}: ${check.errors.join("; ")} — skipped XML`);
      continue;
    }
    const stem = selectsStem(iv.id, version);
    const { xml, placed, totalFrames } = buildSelectsXml(iv.selects, cueMap(cues), source, {
      sequenceName: stem,
      punchScale: s.punchScale,
      punchOn: s.punchOn,
      punchCenter: { horiz: 0, vert: 0 },
    });
    const xf = join(dirs.x, `${stem}.xml`);
    await writeFile(xf, xml);
    files.push(xf);
    for (const p of placed) if (!p.select.line) p.text = cleanVerbatim(p.text, iv.fixes);
    entries.push({ name: iv.name, company: iv.company, xmlFile: `${stem}.xml`, rate: source.rate, placed, totalFrames });
    iv.status.export = "done";
  }

  if (entries.length) {
    const title = `${project.name} – Paper Edits V${version}`;
    const ph = join(dirs.p, `PAPER_EDITS_V${version}.html`);
    const pc = join(dirs.p, `PAPER_EDITS_V${version}.csv`);
    await writeFile(ph, paperEditHtml(entries, { title, punchScale: s.punchScale }));
    await writeFile(pc, paperEditCsv(entries));
    files.push(ph, pc);
  }
  return { files, warnings };
}

/** Run `fn` over items with at most `n` in flight. */
export async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          await fn(items[i]);
          results[i] = { status: "fulfilled", value: undefined };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}
