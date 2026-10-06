/**
 * The select picker's tool loop, against a scripted fake of the Messages API:
 * Claude first submits a cut that crosses a clip boundary, gets the error back,
 * checks a fixed cut, then submits it.
 */
import { describe, expect, it } from "vitest";
import { Claude } from "../src/core/claude/client";
import { pickSelects } from "../src/core/claude/stages";
import { parsePremiereXml } from "../src/core/premiere";
import { parseSrt } from "../src/core/srt";
import { SRT, XML } from "./fixtures";

function fakeClaude(script: { name: string; input: unknown }[]) {
  const c = new Claude({ apiKey: "test", model: "test-model" });
  const seen: unknown[] = [];
  let i = 0;
  (c as unknown as { client: unknown }).client = {
    messages: {
      create: async (req: { messages: unknown[] }) => {
        seen.push(req.messages[req.messages.length - 1]);
        const step = script[i++];
        return {
          content: [{ type: "tool_use", id: `t${i}`, name: step.name, input: step.input }],
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
        };
      },
    },
  };
  return { c, seen };
}

describe("pickSelects", () => {
  it("rejects an invalid cut, then accepts a fixed one in range", async () => {
    const bad = [{ theme: "Vision", cue_start: 3, cue_end: 5 }];
    const good = [
      { theme: "Company story", cue_start: 2, cue_end: 3 },
      { theme: "Vision", cue_start: 5, cue_end: 6 },
    ];
    const { c, seen } = fakeClaude([
      { name: "submit_selects", input: { selects: bad, summary: "x" } },
      { name: "check_selects", input: { selects: good } },
      { name: "submit_selects", input: { selects: good, summary: "Opens on the founding, ends on Insight." } },
    ]);
    const r = await pickSelects(c, parseSrt(SRT), undefined, parsePremiereXml(XML), {
      name: "Jane Doe",
      company: "Acme",
      brief: "",
      themes: ["Company story", "Vision", "Insight"],
      targetSeconds: 15,
      toleranceSeconds: 3,
    });
    expect(r.selects.map((s) => [s.cueStart, s.cueEnd])).toEqual([[2, 3], [5, 6]]);
    expect(r.summary).toMatch(/founding/);
    // the first submit came back as an error tool_result
    const firstResult = (seen[1] as { content: { is_error?: boolean; content: string }[] }).content[0];
    expect(firstResult.is_error).toBe(true);
    expect(firstResult.content).toMatch(/clip boundary/);
    expect(c.usage.input).toBe(30);
  });
});
