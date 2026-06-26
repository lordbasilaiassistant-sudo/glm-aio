// GLMClient — the core transport. Runtime-agnostic: uses global fetch + web streams,
// so the same file runs on Node 18+ and Cloudflare Workers.
import type {
  ChatOptions,
  ChatResult,
  Message,
  StreamEvent,
  ToolCall,
  Usage,
} from "./types";
import { GLMError, classifyHttp, classifyThrown } from "./errors";
import { assertModelAllowed, DEFAULT_MODEL, estimateCost } from "./models";
import { Tracer, type DebugHooks, type TracerConfig } from "./debug";

export interface GLMClientConfig {
  /** Defaults to env ZAI_API_KEY. */
  apiKey?: string;
  /** Defaults to https://api.z.ai/api/paas/v4 */
  baseURL?: string;
  /** Default model. Defaults to glm-4.5-flash (the only free one). */
  model?: string;
  /** Allow non-free models (requires a funded key). Default false — money guard. */
  allowPaid?: boolean;
  /** Default thinking mode. Default false (≈50x faster). */
  thinking?: boolean;
  /** Default max output tokens. Default 2048. */
  maxTokens?: number;
  /** Default temperature. Default 0.6. */
  temperature?: number;
  /** Retries for retryable errors. Default 3. */
  maxRetries?: number;
  /** Base backoff (ms) for exponential retry. Default 500. */
  retryBaseMs?: number;
  /** Per-request timeout (ms). Default 120000 (thinking can be slow). */
  timeoutMs?: number;
  /** Injectable fetch (tests/runtimes). Defaults to global fetch. */
  fetch?: typeof fetch;
  // --- instrumentation passthrough ---
  logLevel?: TracerConfig["level"];
  traceFile?: string;
  hooks?: DebugHooks;
  tracer?: Tracer;
}

const DEFAULT_BASE = "https://api.z.ai/api/paas/v4";

export class GLMClient {
  readonly model: string;
  readonly tracer: Tracer;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly allowPaid: boolean;
  private readonly thinking: boolean;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly _fetch: typeof fetch;

  constructor(cfg: GLMClientConfig = {}) {
    const apiKey = cfg.apiKey ?? globalThis.process?.env?.ZAI_API_KEY ?? "";
    if (!apiKey) {
      throw new GLMError("config", "No API key. Pass apiKey or set ZAI_API_KEY.", { retryable: false });
    }
    this.apiKey = apiKey;
    this.baseURL = (cfg.baseURL ?? DEFAULT_BASE).replace(/\/$/, "");
    this.model = cfg.model ?? DEFAULT_MODEL;
    this.allowPaid = cfg.allowPaid ?? false;
    this.thinking = cfg.thinking ?? false;
    this.maxTokens = cfg.maxTokens ?? 2048;
    this.temperature = cfg.temperature ?? 0.6;
    this.maxRetries = cfg.maxRetries ?? 3;
    this.retryBaseMs = cfg.retryBaseMs ?? 500;
    this.timeoutMs = cfg.timeoutMs ?? 120_000;
    const f = cfg.fetch ?? globalThis.fetch;
    if (!f) throw new GLMError("config", "No fetch available in this runtime.", { retryable: false });
    this._fetch = f.bind(globalThis);
    this.tracer =
      cfg.tracer ??
      new Tracer({
        level: cfg.logLevel,
        traceFile: cfg.traceFile,
        hooks: cfg.hooks,
      });
  }

  /** Non-streaming chat completion. */
  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResult> {
    const model = opts.model ?? this.model;
    assertModelAllowed(model, this.allowPaid);
    const body = this.buildBody(messages, opts, model, false);
    const label = opts.traceLabel ?? "chat";

    const { json } = await this.send(body, label, model, opts, false);
    return this.parseResult(json, model, label, false, undefined);
  }

  /** Streaming chat completion. Yields events; the final `done` event carries the aggregate. */
  async *stream(messages: Message[], opts: ChatOptions = {}): AsyncGenerator<StreamEvent, ChatResult, void> {
    const model = opts.model ?? this.model;
    assertModelAllowed(model, this.allowPaid);
    const body = this.buildBody(messages, opts, model, true);
    const label = opts.traceLabel ?? "stream";

    // Streaming does not retry mid-stream; we retry only the initial connect.
    const span = this.tracer.startSpan({ label, model, thinking: body.thinking?.type === "enabled", stream: true, attempt: 1, requestBytes: JSON.stringify(body).length });
    let resp: Response;
    try {
      resp = await this.connect(body, opts);
    } catch (err) {
      this.tracer.failed(span, err);
      throw err;
    }

    let content = "";
    let reasoning = "";
    let finishReason = "stop";
    let usage: Usage | undefined;
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let firstTokenAt: number | undefined;
    const t0 = nowMs();

    try {
      for await (const evt of parseSSE(resp)) {
        if (evt === null) continue;
        const choice = evt.choices?.[0];
        if (evt.usage) usage = normalizeUsage(evt.usage);
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (choice.finish_reason) finishReason = choice.finish_reason;

        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          yield { type: "reasoning", delta: delta.reasoning_content };
        }
        if (typeof delta.content === "string" && delta.content) {
          if (firstTokenAt === undefined) firstTokenAt = nowMs();
          content += delta.content;
          yield { type: "content", delta: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
            toolAcc.set(idx, acc);
            yield { type: "tool_call", index: idx, call: { id: acc.id, type: "function", function: { name: acc.name, arguments: acc.args } } };
          }
        }
      }
    } catch (err) {
      const e = classifyThrown(err, false);
      const streamErr = e.kind === "network" ? new GLMError("stream", `Stream interrupted: ${e.message}`, { retryable: false, cause: err }) : e;
      this.tracer.failed(span, streamErr);
      throw streamErr;
    }

    const toolCalls: ToolCall[] = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ id: v.id || `call_${v.name}`, type: "function" as const, function: { name: v.name, arguments: v.args } }));

    usage ??= emptyUsage();
    const costUsd = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
    const ttftMs = firstTokenAt !== undefined ? Math.round(firstTokenAt - t0) : undefined;
    this.tracer.endSpan(span, { usage, finishReason, toolCalls: toolCalls.length, costUsd, ttftMs });

    const result: ChatResult = { content, reasoning, toolCalls, finishReason, usage, model, raw: null, trace: span };
    yield { type: "done", result };
    return result;
  }

  // ---- internals ----

  private buildBody(messages: Message[], opts: ChatOptions, model: string, stream: boolean) {
    const thinkingOn = opts.thinking ?? this.thinking;
    const body: Record<string, unknown> = {
      model,
      messages,
      stream,
      temperature: opts.temperature ?? this.temperature,
      max_tokens: opts.maxTokens ?? this.maxTokens,
      // Verified: disabling thinking cuts latency ~50x and reasoning tokens to 0.
      thinking: { type: thinkingOn ? "enabled" : "disabled" },
    };
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (opts.stop) body.stop = opts.stop;
    if (opts.tools?.length) body.tools = opts.tools;
    if (opts.toolChoice !== undefined) body.tool_choice = opts.toolChoice;
    if (stream) body.stream_options = { include_usage: true };
    if (opts.extra) Object.assign(body, opts.extra);
    return body as Record<string, unknown> & { thinking: { type: string } };
  }

  /** Non-streaming send with retry/backoff. */
  private async send(body: Record<string, unknown>, label: string, model: string, opts: ChatOptions, stream: boolean) {
    const reqBytes = JSON.stringify(body).length;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      const span = this.tracer.startSpan({ label, model, thinking: (body.thinking as { type: string }).type === "enabled", stream, attempt, requestBytes: reqBytes });
      try {
        const resp = await this.connect(body, opts);
        const text = await resp.text();
        if (!resp.ok) {
          const err = classifyHttp(resp.status, text, parseRetryAfter(resp));
          throw err;
        }
        const json = JSON.parse(text);
        const usage = normalizeUsage(json?.usage);
        const choice = json?.choices?.[0];
        const costUsd = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
        this.tracer.endSpan(span, { usage, finishReason: choice?.finish_reason ?? "stop", toolCalls: choice?.message?.tool_calls?.length ?? 0, costUsd });
        return { json, span };
      } catch (rawErr) {
        const err = rawErr instanceof GLMError ? rawErr : classifyThrown(rawErr, false);
        const canRetry = err.retryable && attempt <= this.maxRetries;
        if (!canRetry) {
          this.tracer.failed(span, err);
          throw err;
        }
        const delay = this.backoff(attempt, err.retryAfter);
        this.tracer.endSpan(span, { finishReason: "retry" });
        this.tracer.retried(span, err, delay);
        await sleep(delay);
      }
    }
  }

  /** One fetch with timeout. Throws GLMError on transport failure. */
  private async connect(body: Record<string, unknown>, opts: ChatOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    const onAbort = () => {
      timedOut = true;
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await this._fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw classifyThrown(err, timedOut);
    } finally {
      clearTimeout(timer);
    }
  }

  private backoff(attempt: number, retryAfterSec?: number): number {
    if (retryAfterSec) return Math.min(retryAfterSec * 1000, 30_000);
    const exp = this.retryBaseMs * 2 ** (attempt - 1);
    const jitter = exp * 0.25 * Math.random();
    return Math.min(Math.round(exp + jitter), 30_000);
  }

  private parseResult(json: any, model: string, _label: string, _stream: boolean, _span: unknown): ChatResult {
    const choice = json?.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const usage = normalizeUsage(json?.usage);
    const span = this.tracer.spans().at(-1)!;
    return {
      content: typeof msg.content === "string" ? msg.content : "",
      reasoning: typeof msg.reasoning_content === "string" ? msg.reasoning_content : "",
      toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
      finishReason: choice.finish_reason ?? "stop",
      usage,
      model,
      raw: json,
      trace: span,
    };
  }
}

// ---- helpers ----

function normalizeUsage(u: any): Usage {
  if (!u) return emptyUsage();
  return {
    prompt_tokens: u.prompt_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

function emptyUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cached_tokens: 0 };
}

function parseRetryAfter(resp: Response): number | undefined {
  const h = resp.headers?.get?.("retry-after");
  if (!h) return undefined;
  const n = Number(h);
  return Number.isFinite(n) ? n : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/** Parse an SSE response body into a stream of decoded JSON objects (or null to skip). */
async function* parseSSE(resp: Response): AsyncGenerator<any | null, void, void> {
  if (!resp.body) throw new GLMError("stream", "No response body to stream.", { retryable: false });
  const decoder = new TextDecoder();
  let buf = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = (resp.body as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      // SSE events separated by blank line.
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data);
          } catch {
            yield null;
          }
        }
      }
    }
  } finally {
    reader?.releaseLock?.();
  }
}
