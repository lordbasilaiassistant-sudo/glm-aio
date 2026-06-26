// Error taxonomy for GLM. Grounded in observed z.ai responses:
//   429 + code 1113 -> "Insufficient balance" (PERMANENT, do NOT retry)
//   400 + code 1211 -> "Unknown Model"        (PERMANENT)
//   429 without 1113 -> genuine rate limit     (retry w/ backoff)
//   5xx              -> server                 (retry)
//   network/timeout  -> transient              (retry)
// The distinction matters: blindly retrying a 1113 would hammer the API for nothing.
import { redact } from "./debug";

export type GLMErrorKind =
  | "auth"
  | "insufficient_balance"
  | "unknown_model"
  | "rate_limit"
  | "bad_request"
  | "server"
  | "network"
  | "timeout"
  | "stream"
  | "config"
  | "unknown";

export class GLMError extends Error {
  readonly kind: GLMErrorKind;
  readonly status: number | undefined;
  readonly code: string | number | undefined;
  readonly retryable: boolean;
  readonly responseBody: string | undefined;
  /** seconds to wait, parsed from Retry-After when present. */
  readonly retryAfter: number | undefined;

  constructor(
    kind: GLMErrorKind,
    message: string,
    opts: {
      status?: number;
      code?: string | number;
      retryable?: boolean;
      responseBody?: string;
      retryAfter?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "GLMError";
    this.kind = kind;
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.responseBody = opts.responseBody;
    this.retryAfter = opts.retryAfter;
  }

  toJSON() {
    return {
      kind: this.kind,
      message: this.message,
      status: this.status,
      code: this.code,
      retryable: this.retryable,
    };
  }
}

/** Build a GLMError from an HTTP response status + parsed body. */
export function classifyHttp(status: number, body: string, retryAfter?: number): GLMError {
  let code: string | number | undefined;
  let apiMessage = "";
  try {
    const j = JSON.parse(body);
    code = j?.error?.code ?? j?.code;
    apiMessage = redact(j?.error?.message ?? j?.message ?? "");
  } catch {
    apiMessage = redact(body.slice(0, 200));
  }

  const codeStr = code === undefined ? "" : String(code);
  const base = { status, code, responseBody: body, retryAfter };

  if (codeStr === "1113") {
    return new GLMError(
      "insufficient_balance",
      `No balance for this model — only free models are callable on this key. (${apiMessage})`,
      { ...base, retryable: false },
    );
  }
  if (codeStr === "1211") {
    return new GLMError("unknown_model", `Unknown model. (${apiMessage})`, {
      ...base,
      retryable: false,
    });
  }
  if (status === 401 || status === 403) {
    return new GLMError("auth", `Auth failed — check ZAI_API_KEY. (${apiMessage})`, {
      ...base,
      retryable: false,
    });
  }
  if (status === 429) {
    return new GLMError("rate_limit", `Rate limited. (${apiMessage})`, {
      ...base,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new GLMError("server", `Upstream ${status}. (${apiMessage})`, {
      ...base,
      retryable: true,
    });
  }
  if (status >= 400) {
    return new GLMError("bad_request", `Bad request ${status}. (${apiMessage})`, {
      ...base,
      retryable: false,
    });
  }
  return new GLMError("unknown", `Unexpected status ${status}. (${apiMessage})`, base);
}

/** Wrap a thrown network/abort error into a typed, retry-aware GLMError. */
export function classifyThrown(err: unknown, timedOut: boolean): GLMError {
  if (err instanceof GLMError) return err;
  if (timedOut) {
    return new GLMError("timeout", "Request timed out", { retryable: true, cause: err });
  }
  const name = (err as { name?: string })?.name;
  if (name === "AbortError") {
    return new GLMError("timeout", "Request aborted", { retryable: false, cause: err });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new GLMError("network", `Network error: ${msg}`, { retryable: true, cause: err });
}
