// Core shared types for the GLM harness. Mirrors the z.ai (OpenAI-compatible) wire format,
// plus harness-level options/results. Kept dependency-free so it runs on Node and Workers.

export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  /** null is valid (assistant turns that only call tools). */
  content: string | null;
  /** present on `tool` role messages, echoing the call id. */
  tool_call_id?: string;
  /** optional name (tool name on tool messages). */
  name?: string;
  /** assistant tool-call requests. */
  tool_calls?: ToolCall[];
  /** GLM returns chain-of-thought here, separate from `content`. */
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** JSON-schema function definition sent to the model. */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** reasoning tokens — significant for GLM thinking mode. */
  reasoning_tokens: number;
  /** prompt tokens served from cache (cheaper). */
  cached_tokens: number;
}

export interface ChatOptions {
  model?: string;
  /**
   * Reasoning/chain-of-thought. DEFAULT false.
   * Measured: disabling thinking is ~50x faster (1.2s vs 60s) and burns 0 reasoning tokens.
   * Turn on only for genuinely hard tasks.
   */
  thinking?: boolean;
  temperature?: number;
  /** max output tokens. Default 2048. With thinking on, budget generously — reasoning eats this. */
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: ToolSchema[];
  toolChoice?: ToolChoice;
  /** per-call timeout override (ms). */
  timeoutMs?: number;
  /** caller-supplied cancellation. */
  signal?: AbortSignal;
  /** label that shows up in traces/logs for this call. */
  traceLabel?: string;
  /** raw passthrough merged into the request body (escape hatch for new API params). */
  extra?: Record<string, unknown>;
}

export interface ChatResult {
  /** final answer text (never null — empty string if the model produced none). */
  content: string;
  /** chain-of-thought, empty string when thinking was off. */
  reasoning: string;
  /** tool calls the model wants executed, if any. */
  toolCalls: ToolCall[];
  finishReason: string;
  usage: Usage;
  model: string;
  /** raw provider JSON, for debugging. */
  raw: unknown;
  /** trace span for this call. */
  trace: SpanData;
}

/** Events emitted while streaming. */
export type StreamEvent =
  | { type: "reasoning"; delta: string }
  | { type: "content"; delta: string }
  | { type: "tool_call"; index: number; call: Partial<ToolCall> }
  | { type: "done"; result: ChatResult };

// ---- instrumentation types (defined here to avoid import cycles) ----

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

export interface SpanData {
  id: string;
  label: string;
  model: string;
  thinking: boolean;
  stream: boolean;
  attempt: number;
  startedAt: number;
  endedAt?: number;
  latencyMs?: number;
  /** time to first token (streaming only). */
  ttftMs?: number;
  usage?: Usage;
  finishReason?: string;
  toolCalls?: number;
  requestBytes?: number;
  /** estimated USD cost (0 for free models). */
  costUsd?: number;
  error?: { kind: string; message: string; status?: number; code?: string | number };
}
