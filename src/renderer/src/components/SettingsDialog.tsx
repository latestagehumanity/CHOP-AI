import { useEffect, useState } from "react";
import type { Project } from "../../../core/project";
import { api } from "../api";

export function SettingsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<{ set: boolean; fromEnv: boolean } | null>(null);
  useEffect(() => {
    api.apiKeyStatus().then(setStatus);
  }, []);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label className="field">
          <span>Anthropic API key</span>
          <input type="password" value={key} placeholder={status?.set ? "•••••••• (saved — paste to replace)" : "sk-ant-…"} onChange={(e) => setKey(e.target.value)} />
        </label>
        <p className="muted small-text">
          {status?.fromEnv
            ? "Using ANTHROPIC_API_KEY from the environment."
            : "Stored on this computer only, encrypted with your system keychain. Get a key at console.anthropic.com."}
        </p>
        <p className="muted small-text">Model for this project: {project.settings.model} (change it under Brief &amp; settings).</p>
        <div className="row gap end">
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            disabled={!key.trim()}
            onClick={async () => {
              await api.setApiKey(key);
              onClose();
            }}
          >
            Save key
          </button>
        </div>
      </div>
    </div>
  );
}
