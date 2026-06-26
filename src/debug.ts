// Debug instrumentation. Goals:
//   - structured spans per API call (latency, ttft, tokens, retries, errors)
//   - cumulative counters (calls, tokens, reasoning tokens, retries, errors, est. cost)
//   - leveled logging with secret redaction (the API key is NEVER logged)
//   - pluggable hooks for external observability
//   - works on Node (optional JSONL file sink) AND Workers (in-memory ring buffer)
import type { LogLevel, SpanData, Usage } from "./types";

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export interface DebugHooks {
  onRequest?: (span: SpanData) => void;
  onResponse?: (span: SpanData) => void;
  onRetry?: (span: SpanData, error: unknown, delayMs: number) => void;
  onError?: (span: SpanData, error: unknown) => void;
}

export interface TracerConfig {
  level?: LogLevel;
  /** Node only: append spans as JSON lines to this path. Ignored where fs is unavailable. */
  traceFile?: string;
  hooks?: DebugHooks;
  /** keep at most this many spans in memory (ring buffer). Default 200. */
  ringSize?: number;
}

export interface Counters {
  calls: number;
  retries: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  totalLatencyMs: number;
}

const SECRET_RE = /(Bearer\s+[\w.\-]+|"?(?:api[_-]?key|authorization|zai[_-]?api[_-]?key|token)"?\s*[:=]\s*"?)[\w.\-]{6,}/gi;

/** Strip anything that looks like a key/token from a string before it is logged. */
export function redact(s: string): string {
  return s.replace(SECRET_RE, (_m, p1) => `${p1}***REDACTED***`);
}

let SPAN_SEQ = 0;
function nextSpanId(): string {
  SPAN_SEQ = (SPAN_SEQ + 1) % 1e9;
  // Math.random is fine in app code (the no-random rule is for Workflow scripts only).
  return `sp_${SPAN_SEQ.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class Tracer {
  level: LogLevel;
  private hooks: DebugHooks;
  private ring: SpanData[] = [];
  private ringSize: number;
  private traceFile: string | undefined;
  private fileSink: ((line: string) => void) | null = null;
  counters: Counters = {
    calls: 0,
    retries: 0,
    errors: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    totalLatencyMs: 0,
  };

  constructor(cfg: TracerConfig = {}) {
    this.level = cfg.level ?? (process?.env?.GLM_LOG_LEVEL as LogLevel) ?? "warn";
    this.hooks = cfg.hooks ?? {};
    this.ringSize = cfg.ringSize ?? 200;
    this.traceFile = cfg.traceFile ?? process?.env?.GLM_TRACE_FILE;
    if (this.traceFile) this.initFileSink(this.traceFile);
  }

  private initFileSink(path: string): void {
    // Lazy, best-effort. On Workers there is no node:fs -> silently skip.
    try {
      // Use eval to avoid bundlers hard-failing on the node:fs import in a Worker build.
      const req = (0, eval)("typeof require === 'function' ? require : null");
      if (!req) return;
      const fs = req("node:fs");
      this.fileSink = (line: string) => {
        try {
          fs.appendFileSync(path, line + "\n");
        } catch {
          /* ignore */
        }
      };
    } catch {
      this.fileSink = null;
    }
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_RANK[level] <= LEVEL_RANK[this.level];
  }

  log(level: Exclude<LogLevel, "silent">, msg: string, data?: unknown): void {
    if (!this.enabled(level)) return;
    const line = data === undefined ? msg : `${msg} ${redact(safeJson(data))}`;
    const out = `[glm:${level}] ${redact(line)}`;
    if (level === "error") console.error(out);
    else if (level === "warn") console.warn(out);
    else console.log(out);
  }

  startSpan(init: Pick<SpanData, "label" | "model" | "thinking" | "stream" | "attempt"> & { requestBytes?: number }): SpanData {
    const span: SpanData = {
      id: nextSpanId(),
      startedAt: now(),
      ...init,
    };
    this.hooks.onRequest?.(span);
    this.log("debug", `→ ${span.label} model=${span.model} thinking=${span.thinking} attempt=${span.attempt}`);
    return span;
  }

  endSpan(span: SpanData, fields: Partial<SpanData> & { usage?: Usage; costUsd?: number }): SpanData {
    span.endedAt = now();
    span.latencyMs = Math.round(span.endedAt - span.startedAt);
    Object.assign(span, fields);

    this.counters.calls += 1;
    this.counters.totalLatencyMs += span.latencyMs;
    if (span.usage) {
      this.counters.promptTokens += span.usage.prompt_tokens;
      this.counters.completionTokens += span.usage.completion_tokens;
      this.counters.reasoningTokens += span.usage.reasoning_tokens;
      this.counters.cachedTokens += span.usage.cached_tokens;
      this.counters.totalTokens += span.usage.total_tokens;
    }
    if (span.costUsd) this.counters.costUsd += span.costUsd;

    this.push(span);
    this.hooks.onResponse?.(span);
    this.log(
      "info",
      `← ${span.label} ${span.latencyMs}ms` +
        (span.ttftMs !== undefined ? ` ttft=${span.ttftMs}ms` : "") +
        (span.usage ? ` tok(p/c/r)=${span.usage.prompt_tokens}/${span.usage.completion_tokens}/${span.usage.reasoning_tokens}` : "") +
        (span.finishReason ? ` finish=${span.finishReason}` : "") +
        (span.costUsd ? ` $${span.costUsd.toFixed(6)}` : ""),
    );
    return span;
  }

  retried(span: SpanData, error: unknown, delayMs: number): void {
    this.counters.retries += 1;
    this.hooks.onRetry?.(span, error, delayMs);
    this.log("warn", `retry ${span.label} in ${delayMs}ms after`, errSummary(error));
  }

  failed(span: SpanData, error: unknown): void {
    span.endedAt = now();
    span.latencyMs = Math.round(span.endedAt - span.startedAt);
    span.error = errSummary(error);
    this.counters.errors += 1;
    this.push(span);
    this.hooks.onError?.(span, error);
    this.log("error", `✗ ${span.label} ${span.latencyMs}ms`, span.error);
  }

  private push(span: SpanData): void {
    this.ring.push(span);
    if (this.ring.length > this.ringSize) this.ring.shift();
    if (this.fileSink) this.fileSink(safeJson(span));
  }

  /** Recent spans (newest last). */
  spans(): readonly SpanData[] {
    return this.ring;
  }

  /** Cumulative summary for end-of-run reporting. */
  summary(): Counters & { avgLatencyMs: number } {
    const c = this.counters;
    return { ...c, avgLatencyMs: c.calls ? Math.round(c.totalLatencyMs / c.calls) : 0 };
  }

  resetCounters(): void {
    this.counters = {
      calls: 0, retries: 0, errors: 0, promptTokens: 0, completionTokens: 0,
      reasoningTokens: 0, cachedTokens: 0, totalTokens: 0, costUsd: 0, totalLatencyMs: 0,
    };
  }
}

function errSummary(error: unknown): { kind: string; message: string; status?: number; code?: string | number } {
  const e = error as { kind?: string; message?: string; status?: number; code?: string | number };
  return {
    kind: e?.kind ?? "unknown",
    message: redact(String(e?.message ?? error)),
    status: e?.status,
    code: e?.code,
  };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function now(): number {
  // performance.now where available (monotonic), else Date.now.
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}
