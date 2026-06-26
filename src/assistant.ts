// Assistant — "our own assistant". Ties the client + a tool registry + conversation
// memory into one callable thing. Runs the agentic loop (model → tools → model) until
// the model returns a final answer or maxSteps is hit. Every step is traced.
import type { ChatOptions, Message, StreamEvent, ToolCall, Usage } from "./types";
import { GLMClient, type GLMClientConfig } from "./client";
import { ToolRegistry, type ToolContext, type ToolDef } from "./tools";
import type { MemoryStore } from "./memory";
import { cleanText } from "./util";

export interface AssistantConfig extends GLMClientConfig {
  /** display name (used in default system prompt + traces). */
  name?: string;
  /** system prompt. A sensible default is supplied if omitted. */
  system?: string;
  tools?: ToolDef[];
  /** max model↔tool round trips before forcing a stop. Default 8. */
  maxSteps?: number;
  /** seed conversation (excluding system). */
  history?: Message[];
  /** persistent memory backend. When set with sessionId, history survives restarts. */
  store?: MemoryStore;
  /** key under which this agent's conversation is persisted. */
  sessionId?: string;
  /** keep only the last N history messages (bounds growth; trims at a user boundary). */
  maxHistory?: number;
}

export interface AskResult {
  text: string;
  reasoning: string;
  /** number of model calls made. */
  steps: number;
  /** tool calls executed across the run. */
  toolRuns: { name: string; args: string; result: string }[];
  /** cumulative token usage for this ask. */
  usage: Usage;
  /** full message list appended this run (assistant + tool messages). */
  messages: Message[];
}

const DEFAULT_SYSTEM = (name: string) =>
  `You are ${name}, a precise, autonomous assistant running on GLM. ` +
  `Be terse and accurate. Use tools when they help; never fabricate tool output. ` +
  `When you have the answer, state it directly.`;

export class Assistant {
  readonly client: GLMClient;
  readonly registry: ToolRegistry;
  readonly name: string;
  private system: string;
  private maxSteps: number;
  private history: Message[];
  private store: MemoryStore | undefined;
  private sessionId: string | undefined;
  private maxHistory: number | undefined;

  constructor(cfg: AssistantConfig = {}) {
    this.name = cfg.name ?? "Assistant";
    this.client = new GLMClient(cfg);
    this.registry = new ToolRegistry(cfg.tools ?? []);
    this.system = cfg.system ?? DEFAULT_SYSTEM(this.name);
    this.maxSteps = cfg.maxSteps ?? 8;
    this.history = cfg.history ? [...cfg.history] : [];
    this.store = cfg.store;
    this.sessionId = cfg.sessionId;
    this.maxHistory = cfg.maxHistory;
  }

  /** Current conversation (system + history). */
  get conversation(): Message[] {
    return [{ role: "system", content: this.system }, ...this.history];
  }

  reset(): void {
    this.history = [];
  }

  setSystem(s: string): void {
    this.system = s;
  }

  /**
   * Run a turn: hydrate memory, append user input, loop through any tool calls,
   * persist, and return the final answer. Pass `ctx.sessionId` to override the
   * configured session for this call.
   */
  async ask(input: string, opts: ChatOptions = {}, ctx: ToolContext = {}): Promise<AskResult> {
    const sessionId = (typeof ctx.sessionId === "string" ? ctx.sessionId : undefined) ?? this.sessionId;
    if (this.store && sessionId) {
      this.history = await this.store.load(sessionId);
    }
    this.history.push({ role: "user", content: input });

    const toolRuns: AskResult["toolRuns"] = [];
    const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 };
    const appended: Message[] = [];
    let steps = 0;
    let lastReasoning = "";
    let finalText = "";
    const tools = this.registry.size ? this.registry.schemas() : undefined;

    for (let step = 0; step < this.maxSteps; step++) {
      steps++;
      const res = await this.client.chat(this.conversation, { ...opts, tools, traceLabel: `${this.name}:step${step + 1}` });
      addUsage(usage, res.usage);
      lastReasoning = res.reasoning || lastReasoning;

      const assistantMsg: Message = {
        role: "assistant",
        content: res.content || null,
        ...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {}),
      };
      this.history.push(assistantMsg);
      appended.push(assistantMsg);

      if (!res.toolCalls.length) {
        finalText = res.content;
        break;
      }

      // Execute every requested tool, append results, loop.
      for (const call of res.toolCalls) {
        const result = await this.runTool(call, ctx);
        toolRuns.push({ name: call.function.name, args: call.function.arguments, result });
        const toolMsg: Message = { role: "tool", tool_call_id: call.id, name: call.function.name, content: result };
        this.history.push(toolMsg);
        appended.push(toolMsg);
      }

      // Last allowed step but the model still wants tools — make one final no-tools
      // call so the caller gets a real answer instead of a dangling tool turn.
      if (step === this.maxSteps - 1) {
        const final = await this.client.chat(this.conversation, { ...opts, traceLabel: `${this.name}:final` });
        addUsage(usage, final.usage);
        const finalMsg: Message = { role: "assistant", content: final.content || null };
        this.history.push(finalMsg);
        appended.push(finalMsg);
        steps += 1;
        finalText = final.content;
        lastReasoning = final.reasoning || lastReasoning;
      }
    }

    await this.persist(sessionId);
    return { text: cleanText(finalText), reasoning: lastReasoning, steps, toolRuns, usage, messages: appended };
  }

  private async persist(sessionId: string | undefined): Promise<void> {
    if (this.maxHistory) this.history = trimHistory(this.history, this.maxHistory);
    if (this.store && sessionId) await this.store.save(sessionId, this.history);
  }

  /**
   * Streaming variant of a single turn — yields content/reasoning deltas as they arrive.
   * Does NOT run the tool loop (use ask() for tools); intended for interactive/UI streaming.
   */
  async *askStream(input: string, opts: ChatOptions = {}): AsyncGenerator<StreamEvent, AskResult, void> {
    if (this.store && this.sessionId) {
      this.history = await this.store.load(this.sessionId);
    }
    this.history.push({ role: "user", content: input });
    const tools = this.registry.size ? this.registry.schemas() : undefined;
    const gen = this.client.stream(this.conversation, { ...opts, tools, traceLabel: `${this.name}:stream` });

    let result: import("./types").ChatResult | undefined;
    let next = await gen.next();
    while (!next.done) {
      const evt = next.value;
      if (evt.type === "done") result = evt.result;
      yield evt;
      next = await gen.next();
    }
    result ??= next.value;

    const msg: Message = {
      role: "assistant",
      content: result.content || null,
      ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
    };
    this.history.push(msg);
    await this.persist(this.sessionId);
    return {
      text: cleanText(result.content),
      reasoning: result.reasoning,
      steps: 1,
      toolRuns: [],
      usage: result.usage,
      messages: [msg],
    };
  }

  private async runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
    return this.registry.execute(call.function.name, call.function.arguments, ctx);
  }
}

function addUsage(acc: Usage, u: Usage): void {
  acc.prompt_tokens += u.prompt_tokens;
  acc.completion_tokens += u.completion_tokens;
  acc.total_tokens += u.total_tokens;
  acc.reasoning_tokens += u.reasoning_tokens;
  acc.cached_tokens += u.cached_tokens;
}

/** Bound history to the last `max` messages, trimming to a user-message boundary
 * so we never start with an orphaned tool/assistant-tool-call turn (which the API rejects). */
function trimHistory(history: Message[], max: number): Message[] {
  if (history.length <= max) return history;
  const tail = history.slice(-max);
  const firstUser = tail.findIndex((m) => m.role === "user");
  return firstUser > 0 ? tail.slice(firstUser) : tail;
}
