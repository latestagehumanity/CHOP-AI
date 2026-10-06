import { useEffect, useState } from "react";
import type { Project } from "../../../core/project";
import { api } from "../api";

export function BriefPanel({ project }: { project: Project }) {
  const s = project.settings;
  const [brief, setBrief] = useState(s.brief);
  const [themes, setThemes] = useState(s.themes.join(", "));
  useEffect(() => setBrief(s.brief), [s.brief]);
  useEffect(() => setThemes(s.themes.join(", ")), [s.themes]);

  const mins = Math.floor(s.targetSeconds / 60);
  const secs = s.targetSeconds % 60;

  return (
    <div className="panel">
      <h1>Brief &amp; edit settings</h1>
      <p className="muted">Claude reads the brief before picking selects for every interview. Paste the client's direction verbatim.</p>

      <label className="field">
        <span>Client brief</span>
        <textarea
          rows={12}
          value={brief}
          placeholder="e.g. Don't include every question. Highlight the key compelling answers that frame the interviewee as smart, visionary…"
          onChange={(e) => setBrief(e.target.value)}
          onBlur={() => brief !== s.brief && api.updateSettings({ brief })}
        />
      </label>

      <label className="field">
        <span>Theme labels (comma separated, in priority order)</span>
        <input value={themes} onChange={(e) => setThemes(e.target.value)} onBlur={() => api.updateSettings({ themes: themes.split(",").map((t) => t.trim()).filter(Boolean) })} />
      </label>

      <div className="grid">
        <label className="field">
          <span>Target runtime</span>
          <div className="row">
            <input type="number" min={0} value={mins} onChange={(e) => api.updateSettings({ targetSeconds: +e.target.value * 60 + secs })} /> min
            <input type="number" min={0} max={59} value={secs} onChange={(e) => api.updateSettings({ targetSeconds: mins * 60 + +e.target.value })} /> sec
          </div>
        </label>
        <label className="field">
          <span>Tolerance (± seconds)</span>
          <input type="number" min={0} value={s.toleranceSeconds} onChange={(e) => api.updateSettings({ toleranceSeconds: +e.target.value })} />
        </label>
        <label className="field">
          <span>Punch-in scale (%)</span>
          <input type="number" min={100} max={200} value={s.punchScale} onChange={(e) => api.updateSettings({ punchScale: +e.target.value })} />
        </label>
        <label className="field">
          <span>Punch-in on</span>
          <select value={s.punchOn} onChange={(e) => api.updateSettings({ punchOn: e.target.value })}>
            <option value="even">Every 2nd select (S02, S04…)</option>
            <option value="odd">Every 1st select (S01, S03…)</option>
            <option value="none">No punch-ins</option>
          </select>
        </label>
        <label className="field">
          <span>Claude model</span>
          <input value={s.model} onChange={(e) => api.updateSettings({ model: e.target.value })} />
        </label>
        <div className="field">
          <span>Reference edit (SRT, optional)</span>
          <div className="row">
            <span className="muted ellipsis">{s.referenceSrtPath?.split(/[\\/]/).pop() ?? "None — Claude uses the target runtime only"}</span>
            <button className="small" onClick={() => api.pickReference()}>
              Choose…
            </button>
          </div>
        </div>
      </div>

      <h2>How it works</h2>
      <ol className="steps">
        <li><b>Add</b> each interview's SRT and the Premiere XML of its interview sequence (File › Export › Final Cut Pro XML). Files pair by name.</li>
        <li><b>Analyze</b> — Claude separates interviewer questions, answers and setup chatter, finds the interviewee's name and company, and lists misheard names to fix.</li>
        <li><b>Pick selects</b> — Claude builds a cut to your target runtime against the brief, checking exact durations and camera-clip boundaries as it goes. Revise any cut with notes.</li>
        <li><b>Clean lines</b> — clean-verbatim text for the paper edit, with anything uncertain flagged “[check audio]”.</li>
        <li><b>Export</b> — client transcripts (HTML for Google Docs/Word, plus Markdown), one paper edit for all interviews (HTML + CSV), and a Premiere selects XML per interview with alternating punch-ins and a marker per select.</li>
      </ol>
    </div>
  );
}
