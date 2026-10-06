/**
 * Electron main process. Owns the project state, the Anthropic API key
 * (encrypted with the OS keychain via safeStorage) and all file/Claude work;
 * the renderer only sends commands and renders snapshots.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Claude } from "../core/claude/client.js";
import { newProject, type Project, type ProjectSettings } from "../core/project.js";
import { checkSelects, type Select } from "../core/selects.js";
import { cueMap } from "../core/srt.js";
import { cleanVerbatim } from "../core/clean.js";
import { framesToTc, secToMinSec } from "../core/timecode.js";
import {
  addFiles, exportProject, loadInterview, loadProject, pool, runAnalyze, runCleanLines, runSelects, saveProject,
} from "../core/pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;
let project: Project = newProject("Untitled project");
let projectPath: string | null = null;
let busy = false;

/* ----------------------------- API key storage ---------------------------- */

const keyFile = () => join(app.getPath("userData"), "anthropic-key.bin");

async function getApiKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (!existsSync(keyFile())) return null;
  const buf = await readFile(keyFile());
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
}

async function setApiKey(key: string) {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, "utf8");
  await writeFile(keyFile(), data, { mode: 0o600 });
}

/* --------------------------------- helpers -------------------------------- */

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);
const log = (line: string) => send("log", line);
const pushProject = () => send("project", { project, path: projectPath, busy });

async function persist() {
  if (projectPath) await saveProject(project, projectPath);
}

async function makeClaude(): Promise<Claude> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");
  return new Claude({ apiKey, model: project.settings.model, onLog: log });
}

async function runStage(ids: string[], stage: "analyze" | "selects" | "lines", feedback?: string) {
  if (busy) throw new Error("Already running — wait for the current job to finish.");
  busy = true;
  pushProject();
  try {
    const claude = await makeClaude();
    const ivs = project.interviews.filter((i) => ids.includes(i.id));
    const res = await pool(ivs, 3, async (iv) => {
      if (stage === "analyze") await runAnalyze(project, iv, claude);
      if (stage === "selects") {
        if (iv.status.analyze !== "done") await runAnalyze(project, iv, claude);
        await runSelects(project, iv, claude, feedback);
      }
      if (stage === "lines") await runCleanLines(iv, claude);
      log(`✓ ${iv.name}: ${stage} done`);
      await persist();
      pushProject();
    });
    res.forEach((r, i) => r.status === "rejected" && log(`✗ ${ivs[i].name}: ${(r.reason as Error).message}`));
    const u = claude.usage;
    log(`Tokens used — input ${u.input.toLocaleString()}, cached ${u.cacheRead.toLocaleString()}, output ${u.output.toLocaleString()}`);
  } finally {
    busy = false;
    await persist();
    pushProject();
  }
}

/* ----------------------------------- IPC ---------------------------------- */

function registerIpc() {
  ipcMain.handle("state", () => ({ project, path: projectPath, busy }));

  ipcMain.handle("apiKey:status", async () => ({ set: !!(await getApiKey()), fromEnv: !!process.env.ANTHROPIC_API_KEY }));
  ipcMain.handle("apiKey:set", async (_e, key: string) => {
    await setApiKey(key.trim());
    return true;
  });

  ipcMain.handle("project:new", async (_e, name: string) => {
    project = newProject(name || "Untitled project");
    projectPath = null;
    pushProject();
  });

  ipcMain.handle("project:open", async () => {
    const r = await dialog.showOpenDialog(win!, { filters: [{ name: "Chop project", extensions: ["json"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return;
    project = await loadProject(r.filePaths[0]);
    projectPath = r.filePaths[0];
    pushProject();
  });

  ipcMain.handle("project:saveAs", async () => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: "chop-project.json", filters: [{ name: "Chop project", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return;
    projectPath = r.filePath;
    await persist();
    pushProject();
  });

  ipcMain.handle("project:settings", async (_e, patch: Partial<ProjectSettings> & { name?: string }) => {
    const { name, ...rest } = patch;
    if (name !== undefined) project.name = name;
    Object.assign(project.settings, rest);
    await persist();
    pushProject();
  });

  ipcMain.handle("files:add", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Add interview SRTs and their Premiere XMLs",
      filters: [{ name: "SRT + Premiere XML", extensions: ["srt", "xml"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (r.canceled) return { added: [], unmatched: [] };
    const out = addFiles(project, r.filePaths);
    await persist();
    pushProject();
    return { added: out.added.map((a) => a.name), unmatched: out.unmatched };
  });

  ipcMain.handle("files:reference", async () => {
    const r = await dialog.showOpenDialog(win!, { title: "Reference edit SRT", filters: [{ name: "SRT", extensions: ["srt"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return;
    project.settings.referenceSrtPath = r.filePaths[0];
    await persist();
    pushProject();
  });

  ipcMain.handle("interview:remove", async (_e, id: string) => {
    project.interviews = project.interviews.filter((i) => i.id !== id);
    await persist();
    pushProject();
  });

  ipcMain.handle("interview:update", async (_e, id: string, patch: { name?: string; company?: string; selects?: Select[] }) => {
    const iv = project.interviews.find((i) => i.id === id);
    if (!iv) return;
    Object.assign(iv, patch);
    await persist();
    pushProject();
  });

  /** Durations, timecodes and text for the review table. */
  ipcMain.handle("interview:check", async (_e, id: string) => {
    const iv = project.interviews.find((i) => i.id === id);
    if (!iv?.selects) return null;
    const { cues, source } = await loadInterview(iv);
    const r = checkSelects(iv.selects, cueMap(cues), source);
    return {
      total: secToMinSec(r.totalSeconds),
      totalSeconds: r.totalSeconds,
      ok: r.ok,
      errors: r.errors,
      rows: r.rows.map((x, i) => ({
        ...x,
        tcIn: framesToTc(x.f0, source.rate),
        tcOut: framesToTc(x.f1, source.rate),
        line: iv.selects![i].line ?? cleanVerbatim(x.text, iv.fixes),
        note: iv.selects![i].note,
      })),
    };
  });

  ipcMain.handle("run", async (_e, stage: "analyze" | "selects" | "lines", ids: string[], feedback?: string) => {
    try {
      await runStage(ids, stage, feedback);
      return { ok: true };
    } catch (e) {
      log(`✗ ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle("export", async (_e, version: number) => {
    const r = await dialog.showOpenDialog(win!, { title: "Export to folder", properties: ["openDirectory", "createDirectory"], defaultPath: project.settings.outputDir });
    if (r.canceled || !r.filePaths[0]) return null;
    project.settings.outputDir = r.filePaths[0];
    const out = await exportProject(project, r.filePaths[0], { version });
    out.files.forEach((f) => log(`  wrote ${f}`));
    out.warnings.forEach((w) => log(`! ${w}`));
    await persist();
    pushProject();
    shell.openPath(r.filePaths[0]);
    return out;
  });
}

/* --------------------------------- window --------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: "Chop AI",
    backgroundColor: "#0f0f10",
    webPreferences: { preload: join(__dirname, "../preload/index.cjs"), contextIsolation: true, sandbox: false },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
