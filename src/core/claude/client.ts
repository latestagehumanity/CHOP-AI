/**
 * Thin wrapper around the Anthropic SDK: a forced single tool call (for
 * structured output) and a multi-turn tool loop (for the select picker, which
 * calls a local `check_selects` tool until its cut is in range).
 */
import Anthropic from "@anthropic-ai/sdk";

export type Tool = Anthropic.Messages.Tool;
type MessageParam = Anthropic.Messages.MessageParam;
type ToolUseBlock = Anthropic.Messages.ToolUseBlock;
type TextBlockParam = Anthropic.Messages.TextBlockParam;

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  /** Called with short human-readable progress lines. */
  onLog?: (line: string) => void;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
}

export class Claude {
  private client: Anthropic;
  usage: Usage = { input: 0, output: 0, cacheRead: 0 };

  constructor(private opts: ClaudeOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
  }

  log(s: string) {
    this.opts.onLog?.(s);
  }

  private track(u: Anthropic.Messages.Usage) {
    this.usage.input += u.input_tokens;
    this.usage.output += u.output_tokens;
    this.usage.cacheRead += u.cache_read_input_tokens ?? 0;
  }

  /** System prompt blocks; the last block is cached so multi-turn loops re-use the transcript. */
  static system(...parts: string[]): TextBlockParam[] {
    return parts.map((text, i) =>
      i === parts.length - 1 ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text },
    );
  }

  /** One request that must answer by calling `tool`; returns the tool input. */
  async structured<T>(system: TextBlockParam[], user: string, tool: Tool, maxTokens = 16000): Promise<T> {
    const res = await this.client.messages.create({
      model: this.opts.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
    });
    this.track(res.usage);
    const call = res.content.find((b): b is ToolUseBlock => b.type === "tool_use");
    if (!call) throw new Error(`Claude did not call ${tool.name} (stop_reason: ${res.stop_reason})`);
    if (res.stop_reason === "max_tokens") throw new Error(`Response was cut off (max_tokens) while calling ${tool.name}`);
    return call.input as T;
  }

  /**
   * Agentic loop. `handlers` run locally for each tool call and return the
   * tool_result text. A handler can end the loop by returning { done: value }.
   */
  async loop<T>(params: {
    system: TextBlockParam[];
    user: string;
    tools: Tool[];
    handlers: Record<string, (input: unknown) => Promise<string | { done: T } | { error: string }>>;
    maxTurns?: number;
    maxTokens?: number;
  }): Promise<T> {
    const messages: MessageParam[] = [{ role: "user", content: params.user }];
    const maxTurns = params.maxTurns ?? 12;
    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await this.client.messages.create({
        model: this.opts.model,
        max_tokens: params.maxTokens ?? 16000,
        system: params.system,
        messages,
        tools: params.tools,
        tool_choice: { type: "any" },
      });
      this.track(res.usage);
      messages.push({ role: "assistant", content: res.content });
      const calls = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      if (!calls.length) {
        messages.push({ role: "user", content: "Please continue by calling one of the tools." });
        continue;
      }
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const h = params.handlers[call.name];
        if (!h) {
          results.push({ type: "tool_result", tool_use_id: call.id, content: `Unknown tool ${call.name}`, is_error: true });
          continue;
        }
        const out = await h(call.input);
        if (typeof out === "object" && "done" in out) return out.done;
        if (typeof out === "object" && "error" in out) results.push({ type: "tool_result", tool_use_id: call.id, content: out.error, is_error: true });
        else results.push({ type: "tool_result", tool_use_id: call.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error(`No final answer after ${maxTurns} turns`);
  }
}
