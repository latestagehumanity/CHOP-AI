# Roadmap

## v0.1 (this release)
- Pipeline that runs end to end: analyze, then pick selects, then clean lines, then export. It works from both the desktop app and the CLI.
- Cuts can be revised with notes. In the UI you can also reorder, delete and re-theme selects.
- Verified against the Insight AI-leaders project. The XML output matches the hand-built sequences, and the transcript structure matches the delivered docs.

## Next up
1. **Google Docs export.** Upload the transcripts and the paper edit straight into a Drive folder (OAuth), so there's no manual HTML import.
2. **Face-aware punch-in centre.** Sample a frame per clip with ffmpeg, detect the face, and set Motion › Position so punches are framed on the eyes. Today every punch is centred.
3. **Audio crossfades.** Add 2–4 frame transitions on the audio tracks at every cut in the XML.
4. **Talent channel pick.** Pick the lav channel automatically (loudest or least noisy) and mute the others. Today all source channels are carried.
5. **Sub-cue trims.** Use word-level timing from Whisper or Premiere's transcript to start and end selects mid-cue, for tighter edits.
6. **Multi-cam.** Support a second angle on V2 and cut between angles instead of punching in.
7. **Transcription in-app.** Go straight from media to SRT, so the SRT step can be skipped.
8. **Project-wide view.** Compare runtimes and theme coverage across interviews, and flag gaps (e.g. "no one answered the ScaleUp question").
9. **Prompt presets.** Save house style and per-client brief templates.
10. **Extended thinking** for the select picker, plus an option to show its reasoning.

## Known limitations
- Clipitems at `start = -1` (transitions in the source sequence) are ignored.
- Only the first video track is read, so the camera must be on V1.
- Packaged builds are unsigned. Signing and notarising for macOS distribution is still to do.
