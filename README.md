# glm-aio

**All-in-one harness for GLM (z.ai) models.** One TypeScript codebase that runs the
*same* client on **Node** (local) and **Cloudflare Workers** (autonomous, off your PC).
Efficient, accurate, and fully instrumented — every call is traced (latency, tokens,
reasoning tokens, cost, retries).

Built and verified live against the z.ai API on 2026-06-26.

---

## Why it exists

z.ai exposes GLM models on an OpenAI-compatible API, but the naive client gets three
things wrong. This harness gets them right, with the evidence baked in:

| Reality (measured) | What the harness does |
|---|---|
| Only **`glm-4.5-flash`** is free on a zero-balance key; everything else returns `429 / code 1113`. | **Money guard**: refuses to call any non-free model unless you pass `allowPaid: true`. Defaults to the free model. |
| GLM is a **reasoning model** — thinking ON took **15s** and burned 600+ reasoning tokens for `17×23`; thinking OFF answered in **~1s**. | **Thinking OFF by default** (`{"thinking":{"type":"disabled"}}`). Opt in per call for hard tasks. |
| `429` here usually means **"no balance" (permanent)**, not a transient rate limit. | **Error taxonomy**: `1113` is non-retryable; genuine rate limits / 5xx / network errors retry with backoff. |

## Install

```bash
npm install
# set your key (server-side only — never ship it to a browser)
export ZAI_API_KEY=...        # or place it in ~/.claude/secrets/zai.env
```

No runtime dependencies. Node 18+ (needs global `fetch`).

## Quickstart

```ts
import { GLMClient, Assistant, tool } from "glm-aio";

// one-shot
const client = new GLMClient();                  // reads ZAI_API_KEY, model=glm-4.5-flash
const r = await client.chat([{ role: "user", content: "Say hi" }]);
console.log(r.content, r.usage);

// reasoning when you actually need it
await client.chat([{ role: "user", content: "Prove sqrt(2) is irrational." }], { thinking: true, maxTokens: 4000 });

// streaming
for await (const e of client.stream([{ role: "user", content: "Count to 5" }])) {
  if (e.type === "content") process.stdout.write(e.delta);
}
```

### An assistant with tools

```ts
const assistant = new Assistant({
  name: "Aria",
  tools: [
    tool({
      name: "multiply",
      description: "Multiply two integers.",
      parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
      handler: ({ a, b }) => ({ product: a * b }),
    }),
  ],
});

const out = await assistant.ask("What is 17 times 23? Use the tool.");
console.log(out.text);       // "The result of 17 times 23 is 391."
console.log(out.toolRuns);   // [{ name: "multiply", args: '{"a":17,"b":23}', result: '{"product":391}' }]
```

## Debug instrumentation

Every call produces a trace span and updates cumulative counters.

```ts
const client = new GLMClient({
  logLevel: "info",            // silent | error | warn | info | debug | trace  (or env GLM_LOG_LEVEL)
  traceFile: "glm-trace.jsonl",// Node only: append every span as JSON (auto-skipped on Workers)
  hooks: {
    onResponse: (span) => metrics.observe(span.latencyMs),
    onRetry:    (span, err, delayMs) => console.warn("retrying", err),
  },
});

await client.chat([{ role: "user", content: "hi" }]);
console.log(client.tracer.summary());
// { calls, retries, errors, promptTokens, completionTokens, reasoningTokens, costUsd, avgLatencyMs, ... }
```

The API key is **never** logged — output is run through a redactor. Cost is estimated
per model (always `0` for the free model).

## Run it

```bash
npm test            # offline unit tests (no network)
npm run smoke       # live end-to-end against the real API (reads ~/.claude/secrets/zai.env)
npm run example     # examples/local.ts
npm run agent       # examples/agent.ts (tool loop)
npm run typecheck
```

## Deploy to Cloudflare (off-PC, autonomous)

The same harness runs in a Worker — HTTP API + a Cron trigger for autonomous runs.

```bash
wrangler secret put ZAI_API_KEY      # key lives only as a Worker secret
wrangler secret put GATEWAY_TOKEN    # bearer token clients must send
wrangler deploy
```

Endpoints (all gated by `Authorization: Bearer <GATEWAY_TOKEN>`):

- `GET  /`          — service info
- `POST /chat`      — `{ messages, model?, thinking?, maxTokens? }` → completion (`?stream=1` for SSE)
- `POST /ask`       — `{ input, system?, thinking?, useTools? }` → assistant with built-in tools
- `GET  /healthz`   — liveness

`wrangler.toml` sets a Cron (`0 */6 * * *`) that runs the assistant autonomously and
(optionally) writes results to KV. Adjust the schedule or `CRON_PROMPT` to taste.

## Layout

```
src/
  client.ts     GLMClient — chat + streaming, retries, timeouts, money guard
  assistant.ts  Assistant — model↔tool agentic loop + memory
  tools.ts      ToolRegistry + tool() helper
  debug.ts      Tracer — spans, counters, redaction, file sink, hooks
  errors.ts     GLMError + classifyHttp/classifyThrown (error taxonomy)
  models.ts     model registry + free/paid guard + cost estimation
  types.ts      shared wire + harness types
worker/         Cloudflare Worker entry + Worker-safe built-in tools
scripts/smoke.ts  live verification
test/           offline unit tests
```

---

> Runs on free GLM models via **z.ai**. If you want the bigger GLM models (4.6 / 5.x),
> z.ai's Coding Plan unlocks them — referral link (this is a referral, it helps fund our
> compute): https://z.ai/subscribe?ic=BWTG6TRYYQ

MIT
