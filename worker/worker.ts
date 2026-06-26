// Cloudflare Worker entry — runs the GLM harness OFF your PC (free tier).
// HTTP API (bearer-gated) + Cron trigger that autonomously works queued jobs.
//
// Deploy:
//   wrangler secret put ZAI_API_KEY
//   wrangler secret put GATEWAY_TOKEN
//   wrangler deploy
//
// The key lives ONLY as a Worker secret — never in source, never sent to the client.
import { GLMClient } from "../src/client";
import { Assistant } from "../src/assistant";
import { KVMemoryStore } from "../src/memory";
import { JobStore, type Job } from "../src/jobs";
import { nowIso } from "../src/util";
import type { Message } from "../src/types";
import { builtinTools } from "./tools";
import { AFFILIATES } from "./affiliates";

export interface Env {
  ZAI_API_KEY: string;
  /** bearer token callers must present. */
  GATEWAY_TOKEN?: string;
  /** memory + job queue + status store. */
  GLM_KV?: KVNamespace;
  /** max jobs processed per cron tick. Default 3. */
  CRON_JOBS_PER_TICK?: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-max-age": "86400",
};
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", ...CORS };

// Capability manifest — UPDATE THIS as the system gains tools/automations/apps.
const REGISTRY = {
  automations: [
    { name: "job-worker", trigger: "cron */5m", what: "Works queued goals autonomously off-PC." },
  ],
  apps: [
    { name: "control-center", what: "This cockpit UI (Render static) — talk, dispatch, watch.", url: "" },
  ],
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (req.method === "GET" && url.pathname === "/") {
      return json({
        service: "glm-aio",
        ok: true,
        model: "glm-4.5-flash (free)",
        endpoints: ["POST /chat", "POST /ask", "POST /jobs", "GET /jobs", "GET /jobs/:id", "GET /status", "GET /registry", "GET /healthz"],
        kv: Boolean(env.GLM_KV),
      });
    }
    if (url.pathname === "/healthz") return json({ ok: true });
    if (req.method === "GET" && url.pathname === "/registry") {
      return json({
        model: "glm-4.5-flash (free)",
        tools: builtinTools().map((t) => ({ name: t.name, description: t.description })),
        endpoints: ["POST /chat", "POST /ask", "POST /jobs", "GET /jobs", "GET /jobs/:id", "GET /status"],
        automations: REGISTRY.automations,
        apps: REGISTRY.apps,
        affiliates: AFFILIATES.map((a) => ({ program: a.program, fits: a.fits, earns: a.earns, verified: a.verified })),
      });
    }

    // --- auth gate (protects your free quota) ---
    if (env.GATEWAY_TOKEN) {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (token !== env.GATEWAY_TOKEN) return json({ error: "unauthorized" }, 401);
    }

    try {
      if (req.method === "POST" && url.pathname === "/chat") return await handleChat(req, env, url);
      if (req.method === "POST" && url.pathname === "/ask") return await handleAsk(req, env);
      if (req.method === "POST" && url.pathname === "/jobs") return await handleEnqueue(req, env);
      if (req.method === "GET" && url.pathname === "/jobs") return await handleListJobs(env);
      if (req.method === "GET" && url.pathname.startsWith("/jobs/")) return await handleGetJob(env, url.pathname.slice("/jobs/".length));
      if (req.method === "GET" && url.pathname === "/status") return await handleStatus(env);
      return json({ error: "not found" }, 404);
    } catch (err: unknown) {
      const e = err as { message?: string; kind?: string };
      return json({ error: e?.message ?? String(err), kind: e?.kind }, statusFor(err));
    }
  },

  // Cron Triggers (configured in wrangler.toml) fire here — autonomous, off-PC.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(event, env));
  },
};

// ---- handlers ----

async function handleChat(req: Request, env: Env, url: URL): Promise<Response> {
  const body = (await req.json()) as { messages: Message[]; model?: string; thinking?: boolean; maxTokens?: number };
  if (!Array.isArray(body.messages)) return json({ error: "messages[] required" }, 400);
  const client = new GLMClient({ apiKey: env.ZAI_API_KEY, model: body.model, logLevel: "silent" });
  const opts = { thinking: body.thinking, maxTokens: body.maxTokens };

  if (url.searchParams.get("stream") === "1") {
    return new Response(sseFrom(client.stream(body.messages, opts)), {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
    });
  }
  const res = await client.chat(body.messages, opts);
  return json({ content: res.content, reasoning: res.reasoning, toolCalls: res.toolCalls, finishReason: res.finishReason, usage: res.usage, model: res.model });
}

async function handleAsk(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { input: string; system?: string; thinking?: boolean; useTools?: boolean; sessionId?: string };
  if (!body.input) return json({ error: "input required" }, 400);
  const assistant = new Assistant({
    apiKey: env.ZAI_API_KEY,
    logLevel: "silent",
    system: body.system,
    tools: body.useTools === false ? [] : builtinTools(),
    ...(env.GLM_KV && body.sessionId ? { store: new KVMemoryStore(env.GLM_KV, { ttlSeconds: 60 * 60 * 24 * 7, maxMessages: 40 }), sessionId: body.sessionId } : {}),
  });
  const r = await assistant.ask(body.input, { thinking: body.thinking });
  return json({ text: r.text, steps: r.steps, toolRuns: r.toolRuns, usage: r.usage, sessionId: body.sessionId });
}

async function handleEnqueue(req: Request, env: Env): Promise<Response> {
  if (!env.GLM_KV) return json({ error: "job queue needs GLM_KV binding" }, 501);
  const body = (await req.json()) as { goal: string; meta?: Record<string, unknown>; now?: boolean };
  if (!body.goal) return json({ error: "goal required" }, 400);
  const store = jobStore(env);
  const job = await store.enqueue(body.goal, "api", body.meta);
  // Optional synchronous run for callers that want the answer immediately.
  if (body.now) {
    const [done] = await store.process((j) => runJob(j, env), 1);
    return json({ job: done ?? job });
  }
  return json({ job });
}

async function handleListJobs(env: Env): Promise<Response> {
  if (!env.GLM_KV) return json({ error: "needs GLM_KV" }, 501);
  return json({ jobs: await jobStore(env).recent(25) });
}

async function handleGetJob(env: Env, id: string): Promise<Response> {
  if (!env.GLM_KV) return json({ error: "needs GLM_KV" }, 501);
  const job = await jobStore(env).get(id);
  return job ? json({ job }) : json({ error: "not found" }, 404);
}

async function handleStatus(env: Env): Promise<Response> {
  if (!env.GLM_KV) return json({ kv: false, ok: true });
  const last = await env.GLM_KV.get("status:last");
  const pending = await jobStore(env).pendingIds();
  return json({ ok: true, kv: true, pendingJobs: pending.length, lastTick: last ? JSON.parse(last) : null });
}

// ---- cron ----

async function runCron(event: ScheduledEvent, env: Env): Promise<void> {
  const perTick = Number(env.CRON_JOBS_PER_TICK ?? "3") || 3;
  const tick: Record<string, unknown> = { at: nowIso(), cron: event.cron, processed: 0 };

  if (env.GLM_KV) {
    const store = jobStore(env);
    const done = await store.process((j) => runJob(j, env), perTick);
    tick.processed = done.length;
    tick.results = done.map((j) => ({ id: j.id, status: j.status, error: j.error }));
    tick.pendingAfter = (await store.pendingIds()).length;
    await env.GLM_KV.put("status:last", JSON.stringify(tick));
  }
  console.log("[cron]", JSON.stringify(tick));
}

/** Run one job with a fresh agent whose memory is the job's own session. */
async function runJob(job: Job, env: Env): Promise<{ result: string; reasoning?: string; steps?: number; tools?: string[]; usage?: Record<string, number> }> {
  const assistant = new Assistant({
    apiKey: env.ZAI_API_KEY,
    logLevel: "silent",
    name: "Worker",
    tools: builtinTools(),
    ...(env.GLM_KV ? { store: new KVMemoryStore(env.GLM_KV, { prefix: "jobmem:", ttlSeconds: 60 * 60 * 24 * 30, maxMessages: 60 }), sessionId: job.id } : {}),
  });
  const r = await assistant.ask(job.goal, { thinking: false });
  return {
    result: r.text,
    reasoning: r.reasoning,
    steps: r.steps,
    tools: r.toolRuns.map((t) => t.name),
    usage: r.usage as unknown as Record<string, number>,
  };
}

function jobStore(env: Env): JobStore {
  return new JobStore(env.GLM_KV as unknown as import("../src/memory").KVLike, { maxAttempts: 2, recentLimit: 200, ttlSeconds: 60 * 60 * 24 * 30 });
}

// ---- helpers ----

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

function statusFor(err: unknown): number {
  const e = err as { status?: number; kind?: string };
  if (e?.status) return e.status;
  if (e?.kind === "config" || e?.kind === "bad_request") return 400;
  if (e?.kind === "auth") return 401;
  if (e?.kind === "insufficient_balance") return 402;
  return 500;
}

/** Re-emit harness stream events as SSE for browser/client consumers. */
function sseFrom(gen: AsyncGenerator<unknown, unknown, void>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        controller.enqueue(enc.encode(`data: ${JSON.stringify(value)}\n\n`));
      } catch (err: unknown) {
        const e = err as { message?: string };
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "error", error: e?.message ?? String(err) })}\n\n`));
        controller.close();
      }
    },
  });
}
