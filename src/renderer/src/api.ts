import type { ChopApi } from "../../preload/index";
import type { Project } from "../../core/project";

declare global {
  interface Window {
    chop: ChopApi;
  }
}

export const api = window.chop;

export interface AppState {
  project: Project;
  path: string | null;
  busy: boolean;
}

export interface CheckRow {
  index: number;
  theme: string;
  cueStart: number;
  cueEnd: number;
  seconds: number;
  text: string;
  error?: string;
  tcIn: string;
  tcOut: string;
  line?: string;
  note?: string;
}

export interface CheckView {
  total: string;
  totalSeconds: number;
  ok: boolean;
  errors: string[];
  rows: CheckRow[];
}
