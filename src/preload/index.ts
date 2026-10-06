import { contextBridge, ipcRenderer } from "electron";

const api = {
  state: () => ipcRenderer.invoke("state"),
  apiKeyStatus: () => ipcRenderer.invoke("apiKey:status"),
  setApiKey: (key: string) => ipcRenderer.invoke("apiKey:set", key),
  newProject: (name: string) => ipcRenderer.invoke("project:new", name),
  openProject: () => ipcRenderer.invoke("project:open"),
  saveProjectAs: () => ipcRenderer.invoke("project:saveAs"),
  updateSettings: (patch: unknown) => ipcRenderer.invoke("project:settings", patch),
  addFiles: () => ipcRenderer.invoke("files:add"),
  pickReference: () => ipcRenderer.invoke("files:reference"),
  removeInterview: (id: string) => ipcRenderer.invoke("interview:remove", id),
  updateInterview: (id: string, patch: unknown) => ipcRenderer.invoke("interview:update", id, patch),
  checkInterview: (id: string) => ipcRenderer.invoke("interview:check", id),
  run: (stage: "analyze" | "selects" | "lines", ids: string[], feedback?: string) => ipcRenderer.invoke("run", stage, ids, feedback),
  exportAll: (version: number) => ipcRenderer.invoke("export", version),
  onProject: (fn: (s: unknown) => void) => {
    const h = (_: unknown, s: unknown) => fn(s);
    ipcRenderer.on("project", h);
    return () => ipcRenderer.removeListener("project", h);
  },
  onLog: (fn: (line: string) => void) => {
    const h = (_: unknown, l: string) => fn(l);
    ipcRenderer.on("log", h);
    return () => ipcRenderer.removeListener("log", h);
  },
};

contextBridge.exposeInMainWorld("chop", api);
export type ChopApi = typeof api;
