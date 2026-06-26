// Offline unit tests — no network. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLMClient } from "../src/client";
import { Assistant } from "../src/assistant";
import { ToolRegistry, tool } from "../src/tools";
import { classifyHttp } from "../src/errors";
import { isFree, estimateCost, assertModelAllowed } from "../src/models";

// --- mock fetch helpers ---
function jsonResponse(obj: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
}
function sseResponse(events: unknown[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
function completion(opts: { content?: string; reasoning?: string; tool_calls?: unknown[]; finish?: string; usage?: any }) {
  return {
    choices: [{
      message: { role: "assistant", content: opts.content ?? null, reasoning_content: opts.reasoning, tool_calls: opts.tool_calls },
      finish_reason: opts.finish ?? "stop",
    }],
    usage: opts.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, completion_tokens_details: { reasoning_tokens: 0 }, prompt_tokens_details: { cached_tokens: 0 } },
  };
}

const KEY = "test-key";

test("thinking defaults to disabled in the request body", async () => {
  let captured: any;
  const client = new GLMClient({
    apiKey: KEY, logLevel: "silent",
    fetch: (async (_u: string, init: any) => { captured = JSON.parse(init.body); return jsonResponse(completion({ content: "ok" })); }) as any,
  });
  await client.chat([{ role: "user", content: "hi" }]);
  assert.deepEqual(captured.thinking, { type: "disabled" });
});

test("thinking:true flips body to enabled", async () => {
  let captured: any;
  const client = new GLMClient({
    apiKey: KEY, logLevel: "silent",
    fetch: (async (_u: string, init: any) => { captured = JSON.parse(init.body); return jsonResponse(completion({ content: "ok" })); }) as any,
  });
  await client.chat([{ role: "user", content: "hi" }], { thinking: true });
  assert.deepEqual(captured.thinking, { type: "enabled" });
});

test("content + reasoning are split; reasoning tokens normalized", async () => {
  const client = new GLMClient({
    apiKey: KEY, logLevel: "silent",
    fetch: (async () => jsonResponse(completion({
      content: "391", reasoning: "let me think...",
      usage: { prompt_tokens: 18, completion_tokens: 767, total_tokens: 785, completion_tokens_details: { reasoning_tokens: 762 }, prompt_tokens_details: { cached_tokens: 4 } },
    }))) as any,
  });
  const r = await client.chat([{ role: "user", content: "17*23?" }]);
  assert.equal(r.content, "391");
  assert.equal(r.reasoning, "let me think...");
  assert.equal(r.usage.reasoning_tokens, 762);
  assert.equal(r.usage.cached_tokens, 4);
});

test("1113 (insufficient balance) classifies as NON-retryable", () => {
  const err = classifyHttp(429, JSON.stringify({ error: { code: "1113", message: "Insufficient balance" } }));
  assert.equal(err.kind, "insufficient_balance");
  assert.equal(err.retryable, false);
});

test("plain 429 (rate limit) is retryable", () => {
  const err = classifyHttp(429, JSON.stringify({ error: { code: "1302", message: "rate" } }));
  assert.equal(err.kind, "rate_limit");
  assert.equal(err.retryable, true);
});

test("1211 unknown model is non-retryable", () => {
  const err = classifyHttp(400, JSON.stringify({ error: { code: "1211", message: "Unknown Model" } }));
  assert.equal(err.kind, "unknown_model");
  assert.equal(err.retryable, false);
});

test("client retries a 500 then succeeds", async () => {
  let calls = 0;
  const client = new GLMClient({
    apiKey: KEY, logLevel: "silent", retryBaseMs: 1, maxRetries: 3,
    fetch: (async () => {
      calls++;
      if (calls === 1) return jsonResponse({ error: { message: "boom" } }, 500);
      return jsonResponse(completion({ content: "recovered" }));
    }) as any,
  });
  const r = await client.chat([{ role: "user", content: "hi" }]);
  assert.equal(r.content, "recovered");
  assert.equal(calls, 2);
  assert.equal(client.tracer.summary().retries, 1);
});

test("client does NOT retry a 1113", async () => {
  let calls = 0;
  const client = new GLMClient({
    apiKey: KEY, logLevel: "silent", retryBaseMs: 1,
    fetch: (async () => { calls++; return jsonResponse({ error: { code: "1113", message: "no balance" } }, 429); }) as any,
  });
  await assert.rejects(() => client.chat([{ role: "user", content: "hi" }]), /balance/i);
  assert.equal(calls, 1);
});

test("money guard: paid model rejected when allowPaid=false", async () => {
  const client = new GLMClient({ apiKey: KEY, logLevel: "silent", fetch: (async () => jsonResponse(completion({ content: "x" }))) as any });
  await assert.rejects(() => client.chat([{ role: "user", content: "hi" }], { model: "glm-4.6" }), /allowPaid/);
});

test("money guard allows paid model when allowPaid=true", () => {
  assert.doesNotThrow(() => assertModelAllowed("glm-4.6", true));
  assert.throws(() => assertModelAllowed("glm-4.6", false));
  assert.equal(isFree("glm-4.5-flash"), true);
  assert.equal(isFree("glm-4.6"), false);
  assert.equal(estimateCost("glm-4.5-flash", 1000, 1000), 0);
});

test("streaming aggregates content, reasoning, and tool calls", async () => {
  const client = new GLMClient({
    apiKey: KEY, logLevel: "silent",
    fetch: (async () => sseResponse([
      { choices: [{ delta: { reasoning_content: "thinking" } }] },
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{\"a\":" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    ])) as any,
  });
  let content = "";
  const gen = client.stream([{ role: "user", content: "hi" }]);
  let n = await gen.next();
  while (!n.done) {
    if (n.value.type === "content") content += n.value.delta;
    n = await gen.next();
  }
  const final = n.value;
  assert.equal(content, "Hello");
  assert.equal(final.content, "Hello");
  assert.equal(final.reasoning, "thinking");
  assert.equal(final.toolCalls.length, 1);
  assert.equal(final.toolCalls[0]!.function.name, "f");
  assert.equal(final.toolCalls[0]!.function.arguments, '{"a":1}');
  assert.equal(final.finishReason, "tool_calls");
});

test("ToolRegistry handles unknown tool, bad json, and throwing handler", async () => {
  const reg = new ToolRegistry([
    tool({ name: "ok", parameters: {}, handler: () => ({ v: 1 }) }),
    tool({ name: "boom", parameters: {}, handler: () => { throw new Error("nope"); } }),
  ]);
  assert.match(await reg.execute("missing", "{}"), /unknown tool/);
  assert.match(await reg.execute("ok", "{bad json"), /invalid JSON/);
  assert.equal(await reg.execute("ok", '{"x":1}'), '{"v":1}');
  assert.match(await reg.execute("boom", "{}"), /threw/);
});

test("Assistant runs a full tool loop and returns the final answer", async () => {
  // First call -> model asks for tool; second call -> final answer.
  const assistant = new Assistant({
    apiKey: KEY, logLevel: "silent",
    tools: [tool({ name: "add", parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } }, handler: (x: any) => ({ sum: x.a + x.b }) })],
    fetch: (async (_u: string, init: any) => {
      const body = JSON.parse(init.body);
      const hasToolResult = body.messages.some((m: any) => m.role === "tool");
      if (!hasToolResult) {
        return jsonResponse(completion({ tool_calls: [{ id: "c1", type: "function", function: { name: "add", arguments: '{"a":2,"b":3}' } }], finish: "tool_calls" }));
      }
      return jsonResponse(completion({ content: "The sum is 5." }));
    }) as any,
  });
  const r = await assistant.ask("add 2 and 3");
  assert.equal(r.text, "The sum is 5.");
  assert.equal(r.steps, 2);
  assert.equal(r.toolRuns.length, 1);
  assert.equal(r.toolRuns[0]!.result, '{"sum":5}');
});
