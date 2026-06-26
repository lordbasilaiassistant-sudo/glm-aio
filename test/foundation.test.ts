// Tests for the memory + jobs + persistence foundation. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Assistant } from "../src/assistant";
import { InMemoryStore, KVMemoryStore, type KVLike } from "../src/memory";
import { JobStore } from "../src/jobs";
import { cleanText } from "../src/util";

// fake KV
class FakeKV implements KVLike {
  m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}
function jsonResponse(obj: unknown) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}
function completion(content: string) {
  return { choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } };
}

test("cleanText strips leading newlines only", () => {
  assert.equal(cleanText("\n\nhi"), "hi");
  assert.equal(cleanText("hi\n"), "hi\n");
  assert.equal(cleanText("  x"), "  x");
});

test("InMemoryStore isolates stored copies", async () => {
  const store = new InMemoryStore();
  const msgs = [{ role: "user" as const, content: "a" }];
  await store.save("s", msgs);
  msgs.push({ role: "user", content: "b" });
  assert.equal((await store.load("s")).length, 1); // external mutation must not leak in
});

test("KVMemoryStore roundtrip + maxMessages trim + clear", async () => {
  const store = new KVMemoryStore(new FakeKV(), { maxMessages: 2 });
  await store.save("s", [
    { role: "user", content: "1" },
    { role: "assistant", content: "2" },
    { role: "user", content: "3" },
  ]);
  const loaded = await store.load("s");
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0]!.content, "2"); // kept the last 2
  await store.clear("s");
  assert.deepEqual(await store.load("s"), []);
});

test("Assistant rehydrates prior history from the store (stateless worker pattern)", async () => {
  const store = new InMemoryStore();
  let lastBody: { messages: { content: string }[] } = { messages: [] };
  const make = () =>
    new Assistant({
      apiKey: "k", logLevel: "silent", store, sessionId: "s1",
      fetch: (async (_u: string, init: { body: string }) => { lastBody = JSON.parse(init.body); return jsonResponse(completion("ok")); }) as unknown as typeof fetch,
    });
  await make().ask("my name is Zog"); // fresh instance #1
  await make().ask("hello again"); // fresh instance #2 must load #1's turn
  assert.ok(lastBody.messages.some((m) => m.content === "my name is Zog"), "second call should include the first turn from memory");
});

test("JobStore enqueue + process happy path", async () => {
  const store = new JobStore(new FakeKV(), { maxAttempts: 2 });
  const job = await store.enqueue("do thing", "test");
  assert.equal(job.status, "pending");
  assert.deepEqual(await store.pendingIds(), [job.id]);

  const done = await store.process(async (j) => ({ result: `did: ${j.goal}` }), 5);
  assert.equal(done.length, 1);
  assert.equal(done[0]!.status, "done");
  assert.equal(done[0]!.result, "did: do thing");
  assert.deepEqual(await store.pendingIds(), []);
  assert.equal((await store.get(job.id))!.status, "done");
});

test("JobStore requeues on failure then errors after maxAttempts", async () => {
  const store = new JobStore(new FakeKV(), { maxAttempts: 2 });
  const job = await store.enqueue("boom");

  await store.process(async () => { throw new Error("nope"); }, 5);
  let j = (await store.get(job.id))!;
  assert.equal(j.status, "pending"); // requeued (attempt 1 < 2)
  assert.equal(j.attempts, 1);

  await store.process(async () => { throw new Error("nope again"); }, 5);
  j = (await store.get(job.id))!;
  assert.equal(j.status, "error"); // gave up
  assert.equal(j.attempts, 2);
  assert.match(j.error!, /nope again/);
});

test("JobStore recent() returns most-recent-first", async () => {
  const store = new JobStore(new FakeKV());
  await store.enqueue("a");
  await store.enqueue("b");
  const recent = await store.recent(10);
  assert.equal(recent[0]!.goal, "b");
  assert.equal(recent[1]!.goal, "a");
});
