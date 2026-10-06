import { useCallback, useEffect, useState } from "react";
import type { Interview, Project } from "../../../core/project";
import type { Select } from "../../../core/selects";
import { api, type CheckView } from "../api";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export function CutPanel({ iv, project, busy }: { iv: Interview; project: Project; busy: boolean }) {
  const [check, setCheck] = useState<CheckView | null>(null);
  const [feedback, setFeedback] = useState("");
  const s = project.settings;

  const refresh = useCallback(() => {
    if (iv.selects?.length) api.checkInterview(iv.id).then(setCheck);
    else setCheck(null);
  }, [iv]);
  useEffect(refresh, [refresh]);

  const save = (selects: Select[]) => api.updateInterview(iv.id, { selects });
  const move = (i: number, d: -1 | 1) => {
    const xs = [...(iv.selects ?? [])];
    const j = i + d;
    if (j < 0 || j >= xs.length) return;
    [xs[i], xs[j]] = [xs[j], xs[i]];
    save(xs);
  };
  const remove = (i: number) => save((iv.selects ?? []).filter((_, k) => k !== i));
  const setTheme = (i: number, theme: string) => save((iv.selects ?? []).map((x, k) => (k === i ? { ...x, theme } : x)));

  const total = check?.totalSeconds ?? 0;
  const lo = s.targetSeconds - s.toleranceSeconds;
  const hi = s.targetSeconds + s.toleranceSeconds;
  const inRange = total >= lo && total <= hi;

  return (
    <div className="panel">
      <div className="cut-head">
        <div>
          <input className="h1-input" value={iv.name} onChange={(e) => api.updateInterview(iv.id, { name: e.target.value })} aria-label="Interviewee name" />
          <input className="sub-input" value={iv.company} placeholder="Company" onChange={(e) => api.updateInterview(iv.id, { company: e.target.value })} aria-label="Company" />
          <div className="muted small-text">{iv.srtPath.split(/[\\/]/).pop()} · {iv.xmlPath.split(/[\\/]/).pop()}</div>
        </div>
        <div className="runtime">
          <div className={`big ${check ? (inRange ? "ok" : "off") : ""}`}>{check ? fmt(total) : "–:––"}</div>
          <div className="muted small-text">target {fmt(s.targetSeconds)} ± {s.toleranceSeconds}s</div>
        </div>
      </div>

      <div className="row gap">
        <button disabled={busy} onClick={() => api.run("analyze", [iv.id])}>
          {iv.status.analyze === "done" ? "Re-analyze" : "Analyze"}
        </button>
        <button disabled={busy} className="primary" onClick={() => api.run("selects", [iv.id])}>
          {iv.selects?.length ? "Rebuild cut from scratch" : "Pick selects"}
        </button>
        <button disabled={busy || !iv.selects?.length} onClick={() => api.run("lines", [iv.id])}>
          Clean lines
        </button>
        <button className="danger-link" onClick={() => confirm(`Remove ${iv.name} from the project?`) && api.removeInterview(iv.id)}>
          Remove
        </button>
      </div>

      {iv.error && <div className="error-box">{iv.error}</div>}

      {iv.status.analyze === "done" && (
        <p className="muted small-text">
          Analyzed: {iv.segments?.filter((x) => x.role === "q").length ?? 0} questions
          {iv.fixes?.length ? ` · name fixes: ${iv.fixes.map((f) => `${f.find} → ${f.replace}`).join(", ")}` : ""}
        </p>
      )}

      {iv.selectsSummary && <blockquote className="summary">{iv.selectsSummary}</blockquote>}

      {check && (
        <>
          {!check.ok && <div className="error-box">{check.errors.join(" · ")}</div>}
          <table className="cut">
            <thead>
              <tr>
                <th>#</th>
                <th>Theme</th>
                <th>Source in / out</th>
                <th>Dur</th>
                <th>Frame</th>
                <th>Line</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {check.rows.map((r, i) => {
                const punched = s.punchOn !== "none" && ((s.punchOn === "even" && (i + 1) % 2 === 0) || (s.punchOn === "odd" && (i + 1) % 2 === 1));
                return (
                  <tr key={`${r.cueStart}-${i}`} className={r.error ? "row-err" : ""}>
                    <td className="mono">S{String(i + 1).padStart(2, "0")}</td>
                    <td>
                      <select value={r.theme} onChange={(e) => setTheme(i, e.target.value)}>
                        {[...new Set([...s.themes, r.theme])].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="mono">
                      {r.tcIn}
                      <br />
                      {r.tcOut}
                    </td>
                    <td className="mono">{r.seconds.toFixed(1)}s</td>
                    <td>{punched ? <span className="tag punch">Punch {s.punchScale}%</span> : <span className="tag">Wide</span>}</td>
                    <td className="line">
                      {r.line ?? r.text}
                      {r.note && <div className="note">{r.note}</div>}
                      {r.error && <div className="note err">{r.error}</div>}
                    </td>
                    <td className="actions">
                      <button className="icon" title="Move up" onClick={() => move(i, -1)}>↑</button>
                      <button className="icon" title="Move down" onClick={() => move(i, 1)}>↓</button>
                      <button className="icon" title="Remove" onClick={() => remove(i)}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="revise">
            <label className="field">
              <span>Notes for Claude — revise this cut</span>
              <textarea
                rows={3}
                value={feedback}
                placeholder="e.g. Get it under 4:30, lose the brewery example, open on the founding story, end on the Insight line about people."
                onChange={(e) => setFeedback(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !feedback.trim()}
              onClick={async () => {
                await api.run("selects", [iv.id], feedback);
                setFeedback("");
              }}
            >
              Revise cut
            </button>
          </div>
        </>
      )}

      {!check && iv.status.selects !== "running" && (
        <div className="empty">
          <p>No cut yet. “Pick selects” analyzes the interview if needed, then builds a {fmt(s.targetSeconds)} cut against the brief.</p>
        </div>
      )}
    </div>
  );
}
