# Chop AI

Turn raw interview transcripts into a cut. Chop AI reads each interview's **SRT** and the **Premiere XML** of its interview sequence, uses **Claude** to find the strongest answers against your client brief, and gives you:

- **Client transcripts.** Questions appear as numbered headings, followed by short timecoded answer paragraphs, with setup chatter removed. They come as HTML (which opens straight into Google Docs or Word) and as Markdown.
- **A paper edit.** It covers every interviewee in cut order, with sequence timecodes, durations, wide/punch framing and cleaned lines. It comes as HTML and CSV.
- **A Premiere selects sequence per interview** (FCP7 XML). The soundbites are butt-joined, and the framing alternates between wide (100%) and a punch-in (120%) on every cut, so jump cuts read as reframes. Lav channels come in as linked mono tracks, each select gets a marker, and the sequence relinks to your original media.

You can revise any cut in plain English, for example "get it under 4:30, open on the founding story", and Claude rebuilds it while checking exact durations and camera-clip boundaries.

## Quick start

```bash
npm install
npm run dev
```

1. Open **Settings** and paste your Anthropic API key. It's stored encrypted on your machine.
2. Paste the client brief and set the target runtime under **Brief & settings**. You can also add a reference edit SRT.
3. Use **+ Add SRT + XML** to add every interview's SRT and its XML export. In Premiere, the XML export is **File › Export › Final Cut Pro XML**. Files are paired by name.
4. Run **Analyze → Pick selects → Clean lines → Export**.
5. Import the XMLs into Premiere. On each punch-in clip, nudge **Motion › Position** to reframe on the face.

### CLI

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run chop -- init project.json interviews/*.srt interviews/*.xml --brief brief.txt --target 300
npm run chop -- run project.json exports/
npm run chop -- selects project.json --only alex --feedback "tighter; end on the people line"
npm run chop -- export project.json exports/ --version 2
```

## Notes

- **Media:** this is built for single-camera interviews. If there's a separate recorder WAV, the dialogue audio comes from it; otherwise it comes from the camera audio.
- **Punch quality:** at 120%, a 4K master punched into a 1080 delivery loses nothing. A 4K delivery will soften slightly.
- **Timecodes:** the paper edit uses sequence timecode, so it matches Premiere. The transcripts use clock time.

See [CLAUDE.md](CLAUDE.md) for the architecture and [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.
