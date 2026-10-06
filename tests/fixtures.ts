/**
 * Synthetic fixtures: a 2-camera-clip interview sequence (clip break at 10s)
 * with a 2-channel external WAV on A3/A4 and camera audio on A1/A2.
 * No client media or transcripts are committed to this repo.
 */
export const SRT = `1
00:00:00,000 --> 00:00:02,000
Okay, can you say your name for us?

2
00:00:02,500 --> 00:00:05,000
Sure. I'm Jane Doe, I run Acme.

3
00:00:05,000 --> 00:00:09,500
We started Acme because the the data was trapped.

4
00:00:10,500 --> 00:00:13,000
What's next for AI?

5
00:00:13,500 --> 00:00:18,000
I think, you know, agents will need context.

6
00:00:18,000 --> 00:00:22,000
And working with inside has been great.
`;

const file = (id: string, name: string, dur: number, kind: "video" | "audio") =>
  `<file id="${id}"><name>${name}</name><pathurl>file://localhost/Volumes/X/${name}</pathurl><rate><timebase>24</timebase><ntsc>TRUE</ntsc></rate><duration>${dur}</duration>` +
  `<media>${kind === "video" ? "<video/>" : ""}<audio><channelcount>2</channelcount></audio></media></file>`;

const clip = (id: string, name: string, start: number, end: number, inn: number, dur: number, fileXml: string, track?: number) =>
  `<clipitem id="${id}"><name>${name}</name><duration>${dur}</duration><rate><timebase>24</timebase><ntsc>TRUE</ntsc></rate>` +
  `<start>${start}</start><end>${end}</end><in>${inn}</in><out>${inn + end - start}</out>${fileXml}` +
  (track ? `<sourcetrack><mediatype>audio</mediatype><trackindex>${track}</trackindex></sourcetrack>` : "") +
  `</clipitem>`;

// 10s of 23.976 = 240 frames; camera clip A covers 0-240, clip B 240-600
export const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4"><sequence id="seq-1"><name>JANE_DOE_INTERVIEW_V1</name><duration>600</duration><rate><timebase>24</timebase><ntsc>TRUE</ntsc></rate>
<media><video><format><samplecharacteristics><width>3840</width><height>2160</height></samplecharacteristics></format>
<track>${clip("v1", "A001.mov", 0, 240, 100, 5000, file("file-1", "A001.mov", 5000, "video"))}${clip("v2", "A002.mov", 240, 600, 0, 5000, file("file-2", "A002.mov", 5000, "video"))}</track></video>
<audio>
<track>${clip("a1", "A001.mov", 0, 240, 100, 5000, '<file id="file-1"/>', 1)}</track>
<track>${clip("a2", "A001.mov", 0, 240, 100, 5000, '<file id="file-1"/>', 2)}</track>
<track>${clip("w1", "ZOOM0001.WAV", 0, 600, 2000, 90000, file("file-3", "ZOOM0001.WAV", 90000, "audio"), 1)}</track>
<track>${clip("w2", "ZOOM0001.WAV", 0, 600, 2000, 90000, '<file id="file-3"/>', 2)}</track>
</audio></media></sequence></xmeml>`;
