# Chop AI

Desktop app (Electron + TypeScript + React) that automates the talking-head interview edit workflow:

**SRT + Premiere XML in → client transcripts, a paper edit, and a Premiere selects sequence with punch-ins out.**

Claude does the editorial judgement (who's speaking, which answers to use, in what order, cleaning lines). Deterministic TypeScript does everything that must be exact (timecode math, clip-boundary checks, XML).

## Commands

```bash
npm install            # set ELECTRON_SKIP_BINARY_DOWNLOAD=1 in CI/sandboxes without Electron
npm run dev            # desktop app with hot reload
npm test               # vitest (core + mocked Claude loop)
npm run typecheck
npm run build          # electron-vite → out/
npm run chop -- <cmd>  # CLI, same pipeline (see src/cli/chop.ts header)
npm run dist:mac       # packaged .app/.dmg via electron-builder
```

The CLI and app need `ANTHROPIC_API_KEY` (env) for the Claude stages. The app can also store it, encrypted with OS keychain via `safeStorage`.

## Layout

```
src/core/            pure, testable pipeline (no Electron imports)
  srt.ts             SRT parsing, cue dumps for prompts
  premiere.ts        xmeml v4 reader: V1 camera clips, dialogue audio layout, <file> defs, <format>
  timecode.ts        23.976 / NDF frame math
  clean.ts           regex clean-verbatim + literal name fixes
  transcript.ts      Q/A segments → client transcript (HTML for Google Docs/Word, Markdown)
  selects.ts         Select type + checkSelects (durations, clip-boundary crossings, overlaps)
  xmlgen.ts          selects → Premiere XML (alternating Basic Motion scale, linked mono audio, markers)
  paperedit.ts       paper edit HTML + CSV
  project.ts         Project / Interview model, file pairing, naming
  pipeline.ts        orchestration with fs (shared by app + CLI)
  claude/client.ts   Anthropic SDK wrapper: forced-tool structured calls + agentic tool loop, prompt caching
  claude/stages.ts   analyzeInterview, pickSelects (check_selects/submit_selects loop), cleanLines
src/main/            Electron main: owns project state, IPC, API key storage, dialogs
src/preload/         contextBridge → window.chop
src/renderer/        React UI (Brief & settings, per-interview cut review/revise, activity log)
src/cli/chop.ts      CLI
tests/               vitest; synthetic fixtures only
```

## Pipeline invariants (don't break these)

- **Cue numbers are the stable id.** A select is an inclusive SRT cue range in *cut order*. Timing always comes from the SRT; frames = `round(sec × 24000/1001)`.
- **Never let a select cross a source clip boundary** (camera or audio). `checkSelects` enforces it; `pickSelects` must keep calling `check_selects` until the cut is valid and inside target ± tolerance, and `submit_selects` rejects anything else.
- **XML output**: clips butt-joined from frame 0 on V1; scale alternates 100 / `punchScale` (default punch on even selects); each `<file>` embedded in full once then referenced by id; one linked mono audio track per source channel of the dialogue recorder (external WAV preferred over camera audio); a sequence marker per select named `S## Theme` with the text as comment. Timebase/NTSC and `<format>` copied from the source sequence.
- **Claude never invents words.** Analysis fixes are literal mishearing corrections only; `cleanLines` is clean-verbatim and flags uncertainty as `[check audio]`.
- **No client data in the repo.** Fixtures in `tests/fixtures.ts` are synthetic. `chop-project*.json` and `exports/` are gitignored.

## Origin / reference behaviour

This automates a manual workflow done for an Insight Partners "AI leaders" series (7 interviews, 4K ProRes single camera, 4-channel lav WAV on A3–A6). The TypeScript XML generator was verified to reproduce those hand-built selects sequences clip-for-clip (in/out, scale, file refs, markers), and the transcript builder reproduces the delivered transcript docs' question/paragraph structure. Keep that parity if you refactor.

## Conventions

- ESM throughout; relative imports in `src/core` use `.js` suffixes.
- Keep `src/core` free of Electron and DOM APIs so the CLI and tests can use it.
- Default model is `claude-opus-5-5` (project setting). Use tool calls for structured output; keep the transcript in the cached system block for multi-turn loops.
- UI: dark editorial theme, accent `--accent` (#ff5a36). No `window.prompt` (unsupported in Electron).

See `docs/ROADMAP.md` for what's next.
