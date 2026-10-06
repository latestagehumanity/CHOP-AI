import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { parseSrt, cueMap } from "../src/core/srt";
import { cleanVerbatim } from "../src/core/clean";
import { parsePremiereXml } from "../src/core/premiere";
import { checkSelects } from "../src/core/selects";
import { buildSelectsXml } from "../src/core/xmlgen";
import { buildTranscript } from "../src/core/transcript";
import { pairFiles, guessName, selectsStem } from "../src/core/project";
import { framesToTc, secToFrames } from "../src/core/timecode";
import { paperEditCsv } from "../src/core/paperedit";
import { SRT, XML } from "./fixtures";

const cues = parseSrt(SRT);
const map = cueMap(cues);
const src = parsePremiereXml(XML);
const opts = { sequenceName: "JANE_DOE_SELECTS_V1", punchScale: 120, punchOn: "even" as const, punchCenter: { horiz: 0, vert: 0 } };

describe("timecode", () => {
  it("converts at 23.976", () => {
    expect(secToFrames(10)).toBe(240);
    expect(framesToTc(24 * 61 + 5)).toBe("00:01:01:05");
  });
});

describe("srt", () => {
  it("parses cues with CRLF and BOM", () => {
    const c = parseSrt("﻿" + SRT.replace(/\n/g, "\r\n"));
    expect(c).toHaveLength(6);
    expect(c[1]).toMatchObject({ n: 2, start: 2.5, end: 5, text: "Sure. I'm Jane Doe, I run Acme." });
  });
});

describe("cleanVerbatim", () => {
  it("removes stutters and filler but keeps meaning", () => {
    expect(cleanVerbatim("I think, you know, agents will need context.")).toBe("I think agents will need context.");
    expect(cleanVerbatim("because the the data")).toBe("Because the data");
    expect(cleanVerbatim("what kind of incident")).toBe("What kind of incident");
    expect(cleanVerbatim("a lot of, a lot of my role")).toBe("A lot of my role");
  });
  it("applies literal fixes", () => {
    expect(cleanVerbatim("working with inside has been great", [{ find: "with inside", replace: "with Insight" }])).toBe("Working with Insight has been great");
  });
});

describe("premiere xml", () => {
  it("reads V1 clips, external audio layout, files and format", () => {
    expect(src.video.map((c) => [c.start, c.end, c.in])).toEqual([[0, 240, 100], [240, 600, 0]]);
    expect(src.audio.kind).toBe("external");
    expect(src.audio.sourceTracks).toEqual([1, 2]);
    expect(src.audio.clips[0].fileId).toBe("file-3");
    expect([...src.files.keys()].sort()).toEqual(["file-1", "file-2", "file-3"]);
    expect(src.width).toBe(3840);
  });
});

describe("checkSelects", () => {
  it("measures durations and flags clip-boundary crossings and overlaps", () => {
    const ok = checkSelects([{ theme: "Company story", cueStart: 2, cueEnd: 3 }], map, src);
    expect(ok.ok).toBe(true);
    expect(ok.totalSeconds).toBeCloseTo(7, 1);
    const bad = checkSelects(
      [
        { theme: "Vision", cueStart: 3, cueEnd: 5 },
        { theme: "Vision", cueStart: 5, cueEnd: 6 },
      ],
      map,
      src,
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/camera clip boundary/);
    expect(bad.errors.join(" ")).toMatch(/overlap/);
  });
});

describe("buildSelectsXml", () => {
  const selects = [
    { theme: "Company story", cueStart: 2, cueEnd: 3 },
    { theme: "Vision", cueStart: 5, cueEnd: 5 },
    { theme: "Insight", cueStart: 6, cueEnd: 6 },
  ];
  const { xml, placed, totalFrames } = buildSelectsXml(selects, map, src, opts);
  const doc = new DOMParser().parseFromString(xml.replace("<!DOCTYPE xmeml>", ""), "text/xml");

  it("butt-joins selects from zero and alternates wide / punch", () => {
    expect(placed.map((p) => p.recIn)).toEqual([0, placed[0].recOut, placed[1].recOut]);
    expect(placed.map((p) => p.scale)).toEqual([100, 120, 100]);
    expect(totalFrames).toBe(placed[2].recOut);
  });

  it("maps source in-points through each clip's offset", () => {
    const v = Array.from(doc.getElementsByTagName("clipitem")).filter((c) => c.getAttribute("id")!.startsWith("clipitem-v"));
    // S01 starts at 2.5s = frame 60 in clip A (in 100) -> 160
    expect(v[0].getElementsByTagName("in")[0].textContent).toBe("160");
    // S02 starts at 13.5s = frame 324 in clip B (start 240, in 0) -> 84
    expect(v[1].getElementsByTagName("in")[0].textContent).toBe("84");
  });

  it("writes linked mono audio from the external recorder and one marker per select", () => {
    const a = Array.from(doc.getElementsByTagName("clipitem")).filter((c) => c.getAttribute("id")!.startsWith("clipitem-a1-"));
    expect(a).toHaveLength(2);
    expect(a[0].getElementsByTagName("file")[0].getAttribute("id")).toBe("file-3");
    // 2000 + frame 60
    expect(a[0].getElementsByTagName("in")[0].textContent).toBe("2060");
    expect(doc.getElementsByTagName("marker")).toHaveLength(3);
    // each file defined in full exactly once
    expect(doc.getElementsByTagName("pathurl")).toHaveLength(3);
  });

  it("exports a paper edit CSV", () => {
    const csv = paperEditCsv([{ name: "Jane Doe", company: "Acme", xmlFile: "x.xml", rate: src.rate, placed, totalFrames }]);
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain("Punch");
  });
});

describe("transcript", () => {
  it("numbers questions and drops setup", () => {
    const blocks = buildTranscript(cues, [
      { startCue: 1, role: "x" },
      { startCue: 2, role: "a" },
      { startCue: 4, role: "q" },
      { startCue: 5, role: "a" },
    ]);
    expect(blocks[0]).toMatchObject({ kind: "paragraph" });
    expect(blocks.find((b) => b.kind === "question")).toMatchObject({ qNumber: 1, text: "What's next for AI?" });
    expect(blocks.some((b) => b.text.includes("say your name"))).toBe(false);
  });
});

describe("project", () => {
  it("pairs files by name, ignoring upload hash prefixes", () => {
    const r = pairFiles(["/a/1a2b3c4d-JANE_DOE_INTERVIEW_V1.srt", "/b/JANE_DOE_INTERVIEW_V1.xml", "/c/OTHER.srt"]);
    expect(r.pairs).toHaveLength(1);
    expect(r.unmatched).toEqual(["/c/OTHER.srt"]);
    expect(guessName(r.pairs[0].key)).toBe("Jane Doe");
    expect(selectsStem(r.pairs[0].key, 2)).toBe("JANE_DOE_SELECTS_V2");
  });
});
