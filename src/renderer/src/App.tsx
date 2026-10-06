import { useEffect, useRef, useState } from "react";
import type { Interview, StageStatus } from "../../core/project";
import { api, type AppState } from "./api";
import { BriefPanel } from "./components/BriefPanel";
import { CutPanel } from "./components/CutPanel";
import { SettingsDialog } from "./components/SettingsDialog";

const dot = (s: StageStatus) => <span className={`dot dot-${s}`} title={s} />;

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [selected, setSelected] = useState<string | "brief">("brief");
  const [log, setLog] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keySet, setKeySet] = useState(true);
  const [version, setVersion] = useState(1);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.state().then(setState);
    api.apiKeyStatus().then((s: { set: boolean }) => {
      setKeySet(s.set);
      if (!s.set) setSettingsOpen(true);
    });
    const off1 = api.onProject((s) => setState(s as AppState));
    const off2 = api.onLog((l) => setLog((x) => [...x.slice(-400), l]));
    return () => {
      off1();
      off2();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  if (!state) return null;
  const { project, busy } = state;
  const ivs = project.interviews;
  const current = ivs.find((i) => i.id === selected);
  const allIds = ivs.map((i) => i.id);

  const add = async () => {
    const r = (await api.addFiles()) as { added: string[]; unmatched: string[] };
    if (r.added.length) setLog((x) => [...x, `Added ${r.added.join(", ")}`]);
    if (r.unmatched.length) setLog((x) => [...x, `! No matching SRT/XML pair for: ${r.unmatched.map((p) => p.split(/[\\/]/).pop()).join(", ")}`]);
  };

  const exportAll = () => api.exportAll(version);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▮▯</span> Chop <em>AI</em>
        </div>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => api.updateSettings({ name: e.target.value })}
          aria-label="Project name"
        />
        <span className="muted path">{state.path ?? "unsaved"}</span>
        <div className="spacer" />
        <button onClick={() => api.newProject("Untitled project")}>New</button>
        <button onClick={() => api.openProject()}>Open…</button>
        <button onClick={() => api.saveProjectAs()}>{state.path ? "Save as…" : "Save…"}</button>
        <button className={keySet ? "" : "warn"} onClick={() => setSettingsOpen(true)}>
          {keySet ? "Settings" : "Add API key"}
        </button>
      </header>

      <aside className="sidebar">
        <button className={`nav ${selected === "brief" ? "active" : ""}`} onClick={() => setSelected("brief")}>
          Brief &amp; settings
        </button>
        <div className="side-head">
          <span>Interviews</span>
          <button className="small" onClick={add}>
            + Add SRT + XML
          </button>
        </div>
        {ivs.length === 0 && <p className="muted small-text">Add each interview's SRT and its Premiere XML export. Files are paired by name.</p>}
        {ivs.map((iv: Interview) => (
          <button key={iv.id} className={`nav iv ${selected === iv.id ? "active" : ""}`} onClick={() => setSelected(iv.id)}>
            <span className="iv-name">{iv.name}</span>
            <span className="iv-co">{iv.company || iv.id}</span>
            <span className="dots">
              {dot(iv.status.analyze)}
              {dot(iv.status.selects)}
            </span>
          </button>
        ))}
        <div className="side-actions">
          <button disabled={busy || !ivs.length} onClick={() => api.run("analyze", allIds)}>
            1 · Analyze all
          </button>
          <button disabled={busy || !ivs.length} onClick={() => api.run("selects", allIds)}>
            2 · Pick selects for all
          </button>
          <button disabled={busy || !ivs.some((i) => i.selects?.length)} onClick={() => api.run("lines", ivs.filter((i) => i.selects?.length).map((i) => i.id))}>
            3 · Clean lines
          </button>
          <div className="export-row">
            <button className="primary" disabled={busy || !ivs.length} onClick={exportAll}>
              4 · Export
            </button>
            <label className="muted" title="Version number in the exported file names">
              V<input type="number" min={1} value={version} onChange={(e) => setVersion(Math.max(1, +e.target.value || 1))} />
            </label>
          </div>
          {busy && <div className="busy">Working… <span className="spinner" /></div>}
        </div>
      </aside>

      <main className="main">
        {selected === "brief" || !current ? <BriefPanel project={project} /> : <CutPanel key={current.id} iv={current} project={project} busy={busy} />}
      </main>

      <footer className="log" ref={logRef}>
        {log.length === 0 ? <span className="muted">Activity shows up here.</span> : log.map((l, i) => <div key={i} className={l.startsWith("✗") || l.startsWith("!") ? "log-err" : l.startsWith("✓") ? "log-ok" : ""}>{l}</div>)}
      </footer>

      {settingsOpen && (
        <SettingsDialog
          project={project}
          onClose={async () => {
            setSettingsOpen(false);
            const s = (await api.apiKeyStatus()) as { set: boolean };
            setKeySet(s.set);
          }}
        />
      )}
    </div>
  );
}
