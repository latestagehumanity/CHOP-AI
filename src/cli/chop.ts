#!/usr/bin/env node
/**
 * Chop AI command line — same pipeline as the desktop app, handy for batch
 * runs and for developing in Claude Code.
 *
 *   npm run chop -- init   project.json <srt/xml files...> [--brief brief.txt] [--reference ref.srt] [--target 300] [--name "Insight"]
 *   npm run chop -- analyze project.json [--only ID]
 *   npm run chop -- selects project.json [--only ID] [--feedback "tighter, drop the brewery story"]
 *   npm run chop -- lines   project.json [--only ID]
 *   npm run chop -- export  project.json out/ [--version 2]
 *   npm run chop -- run     project.json out/            (analyze + selects + lines + export)
 *   npm run chop -- check   project.json                 (print each cut's runtime / errors)
 *
 * Needs ANTHROPIC_API_KEY in the environment for the Claude stages.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Claude } from "../core/claude/client.js";
import { newProject, type Interview, type Project } from "../core/project.js";
import { checkSelects, formatCheck } from "../core/selects.js";
import { cueMap } from "../core/srt.js";
import {
  addFiles, exportProject, loadInterview, loadProject, pool, runAnalyze, runCleanLines, runSelects, saveProject,
} from "../core/pipeline.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

function claude(project: Project) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY first.");
  return new Claude({ apiKey, model: process.env.CHOP_MODEL ?? project.settings.model, onLog: (l) => console.log(l) });
}

function pick(project: Project, only?: string): Interview[] {
  if (!only) return project.interviews;
  const ivs = project.interviews.filter((i) => i.id.toLowerCase().includes(only.toLowerCase()) || i.name.toLowerCase().includes(only.toLowerCase()));
  if (!ivs.length) throw new Error(`No interview matches "${only}"`);
  return ivs;
}

async function forEach(project: Project, path: string, ivs: Interview[], fn: (iv: Interview) => Promise<void>) {
  const res = await pool(ivs, 3, async (iv) => {
    await fn(iv);
    await saveProject(project, path); // save as each one lands
  });
  res.forEach((r, i) => r.status === "rejected" && console.error(`✗ ${ivs[i].name}: ${(r.reason as Error).message}`));
}

async function main() {
  const cmd = args.shift();
  const only = flag("only");
  switch (cmd) {
    case "init": {
      const brief = flag("brief");
      const reference = flag("reference");
      const target = flag("target");
      const name = flag("name");
      const [path, ...files] = args;
      if (!path || !files.length) throw new Error("usage: init project.json <srt/xml files...>");
      const project = existsSync(path) ? await loadProject(path) : newProject(name ?? basename(path, ".json"));
      if (brief) project.settings.brief = await readFile(brief, "utf8");
      if (reference) project.settings.referenceSrtPath = reference;
      if (target) project.settings.targetSeconds = +target;
      const { added, unmatched } = addFiles(project, files);
      await saveProject(project, path);
      console.log(`Added ${added.length} interview(s): ${added.map((a) => a.name).join(", ")}`);
      if (unmatched.length) console.log(`Unmatched (need an SRT and XML with the same name): ${unmatched.join(", ")}`);
      break;
    }
    case "analyze":
    case "selects":
    case "lines": {
      const [path] = args;
      const project = await loadProject(path);
      const c = claude(project);
      const feedback = flag("feedback");
      await forEach(project, path, pick(project, only), async (iv) => {
        if (cmd === "analyze") await runAnalyze(project, iv, c);
        if (cmd === "selects") await runSelects(project, iv, c, feedback);
        if (cmd === "lines") await runCleanLines(iv, c);
        console.log(`✓ ${iv.name}`);
      });
      console.log(`Tokens: ${JSON.stringify(c.usage)}`);
      break;
    }
    case "check": {
      const [path] = args;
      const project = await loadProject(path);
      for (const iv of pick(project, only)) {
        const { cues, source } = await loadInterview(iv);
        console.log(`\n${iv.name}${iv.company ? `, ${iv.company}` : ""}`);
        if (!iv.selects?.length) console.log("  (no selects)");
        else console.log(formatCheck(checkSelects(iv.selects, cueMap(cues), source), source));
      }
      break;
    }
    case "export": {
      const version = flag("version");
      const [path, out] = args;
      const project = await loadProject(path);
      const r = await exportProject(project, out, { version: version ? +version : 1 });
      await saveProject(project, path);
      r.files.forEach((f) => console.log(`  ${f}`));
      r.warnings.forEach((w) => console.warn(`! ${w}`));
      break;
    }
    case "run": {
      const [path, out] = args;
      const project = await loadProject(path);
      const c = claude(project);
      await forEach(project, path, pick(project, only), async (iv) => {
        if (iv.status.analyze !== "done") await runAnalyze(project, iv, c);
        await runSelects(project, iv, c);
        await runCleanLines(iv, c);
        console.log(`✓ ${iv.name}`);
      });
      const r = await exportProject(project, out);
      await saveProject(project, path);
      r.files.forEach((f) => console.log(`  ${f}`));
      r.warnings.forEach((w) => console.warn(`! ${w}`));
      console.log(`Tokens: ${JSON.stringify(c.usage)}`);
      break;
    }
    default:
      console.log("Commands: init, analyze, selects, lines, check, export, run  (see src/cli/chop.ts)");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
