// Tests for the company layer: message bus, agent charters, role/QA job flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageBus } from "../src/bus";
import { charterFor, systemFor, COMPANY } from "../src/agents";
import { JobStore } from "../src/jobs";
import type { KVLike } from "../src/memory";

class FakeKV implements KVLike {
  m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}

test("MessageBus: feed is newest-first, inbox is addressed", async () => {
  const b = new MessageBus(new FakeKV());
  await b.post({ from: "coordinator", to: "builder", kind: "task", body: "do X" });
  await b.post({ from: "builder", to: "all", kind: "result", body: "did X" });
  const feed = await b.feed(10);
  assert.equal(feed.length, 2);
  assert.equal(feed[0]!.body, "did X"); // newest first
  const inbox = await b.inbox("builder", 10);
  assert.equal(inbox.length, 1); // only the addressed one (broadcast "all" not in a role inbox)
  assert.equal(inbox[0]!.body, "do X");
});

test("MessageBus: feed respects the cap", async () => {
  const b = new MessageBus(new FakeKV(), { feedLimit: 3 });
  for (let i = 0; i < 6; i++) await b.post({ from: "x", to: "all", kind: "note", body: "m" + i });
  const feed = await b.feed(10);
  assert.equal(feed.length, 3);
  assert.equal(feed[0]!.body, "m5"); // kept the last 3, newest first
});

test("agents: QA charter exists and systemFor builds a prompt", () => {
  assert.ok(COMPANY.some((c) => c.role === "qa"));
  assert.equal(charterFor("qa")!.title, "QA / Tester");
  assert.match(systemFor("qa")!, /QA \/ Tester/);
  assert.match(systemFor("qa")!, /PASS or FAIL/);
  assert.equal(systemFor("nope"), undefined);
});

test("agents: coordinator can self-delegate via dispatch_task", () => {
  const coord = charterFor("coordinator")!;
  assert.ok(coord.tools.includes("dispatch_task"), "coordinator must hold the delegation tool");
  assert.match(systemFor("coordinator")!, /dispatch_task/);
});

test("JobStore carries role + qa from the runner onto the job", async () => {
  const store = new JobStore(new FakeKV());
  const job = await store.enqueue("build a thing", "api", { role: "builder", qa: true });
  const [done] = await store.process(async (j) => ({
    result: "the thing",
    role: typeof j.meta?.role === "string" ? j.meta.role : undefined,
    qa: "PASS — meets the order.",
  }), 1);
  assert.equal(done!.status, "done");
  assert.equal(done!.role, "builder");
  assert.match(done!.qa!, /PASS/);
});
