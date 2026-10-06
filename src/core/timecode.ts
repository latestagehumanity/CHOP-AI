/**
 * Timecode helpers. Premiere xmeml stores everything in frames at an integer
 * timebase with an NTSC flag (24 + ntsc = 23.976). Sequences are NDF.
 */
export interface Rate {
  timebase: number;
  ntsc: boolean;
}

export const DEFAULT_RATE: Rate = { timebase: 24, ntsc: true };

export function fps(rate: Rate): number {
  return rate.ntsc ? (rate.timebase * 1000) / 1001 : rate.timebase;
}

/** Seconds (real time) -> frame count at the given rate. */
export function secToFrames(sec: number, rate: Rate = DEFAULT_RATE): number {
  return Math.round(sec * fps(rate));
}

export function framesToSec(frames: number, rate: Rate = DEFAULT_RATE): number {
  return frames / fps(rate);
}

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

/** Frames -> HH:MM:SS:FF non-drop-frame, counted at the integer timebase (matches Premiere NDF display). */
export function framesToTc(frames: number, rate: Rate = DEFAULT_RATE): string {
  const tb = rate.timebase;
  const f = Math.floor(frames);
  return `${pad(f / (tb * 3600))}:${pad((f / (tb * 60)) % 60)}:${pad((f / tb) % 60)}:${pad(f % tb)}`;
}

/** Seconds -> HH:MM:SS wall-clock (used in transcript docs). */
export function secToClock(sec: number): string {
  const t = Math.floor(sec);
  return `${pad(t / 3600)}:${pad((t % 3600) / 60)}:${pad(t % 60)}`;
}

/** Seconds -> M:SS (used for runtimes). */
export function secToMinSec(sec: number): string {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
