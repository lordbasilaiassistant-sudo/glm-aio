// Tests for the company layer: message bus, agent charters, role/QA job flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageBus } from "../src/bus";
import { charterFor, systemFor, COMPANY, byLayer, byDepartment } from "../src/agents";
import { JobStore } from "../src/jobs";
import { Workspace } from "../src/workspace";
import { inferStage, strategyFor, defaultState } from "../src/strategy";
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

test("agents: layered org — director leads, managers manage, workers report up", () => {
  const layers = byLayer();
  assert.ok(layers.exec.some((c) => c.role === "director"));
  assert.ok(layers.manager.length >= 2);
  assert.ok(layers.worker.some((c) => c.role === "builder"));
  assert.ok(layers.quality.some((c) => c.role === "qa"));

  const director = charterFor("director")!;
  assert.ok(director.tools.includes("dispatch_task") && director.tools.includes("company_strategy"));
  assert.ok(director.manages!.includes("eng_manager") && director.manages!.includes("growth_manager"));

  assert.equal(charterFor("builder")!.reportsTo, "eng_manager");
  assert.equal(charterFor("writer")!.reportsTo, "growth_manager");
  assert.match(systemFor("director")!, /Director/);
  assert.match(systemFor("eng_manager")!, /report to the director/);
});

test("agents: departments group roles, incl. innovation + a CFO for verification", () => {
  const depts = byDepartment();
  assert.ok(depts.executive.some((c) => c.role === "cfo"));
  assert.ok(depts.innovation.some((c) => c.role === "innovator"));
  assert.ok(depts.operations.some((c) => c.role === "coo"));
  assert.ok(depts.engineering.some((c) => c.role === "toolsmith"));
  // generalized pipeline is in every system prompt
  assert.match(systemFor("builder")!, /VERIFY your own output/);
});

test("strategy: stage is derived from real state, plans differ", () => {
  assert.equal(inferStage(defaultState()), "bootstrap");
  assert.equal(inferStage({ revenueUsd: 0, costsUsd: 0, sponsorCreditsUsd: 0, validatedMechanics: ["etsy sheets"] }), "validating");
  assert.equal(inferStage({ revenueUsd: 50, costsUsd: 0, sponsorCreditsUsd: 0, validatedMechanics: [] }), "first_revenue");
  assert.equal(inferStage({ revenueUsd: 900, costsUsd: 0, sponsorCreditsUsd: 0, validatedMechanics: [] }), "growth");
  assert.match(strategyFor("bootstrap").focus, /Spend nothing/i);
  assert.notEqual(strategyFor("bootstrap").focus, strategyFor("growth").focus);
});

test("workspace: shared docs + board round-trip", async () => {
  const ws = new Workspace(new FakeKV());
  await ws.writeDoc("plan", "ship the etsy test");
  assert.equal(await ws.readDoc("plan"), "ship the etsy test");
  await ws.postNote("director", "kicked off plan");
  await ws.postNote("qa", "verified");
  const board = await ws.board(10);
  assert.equal(board.length, 2);
  assert.equal(board[0]!.text, "verified"); // newest first
  assert.equal(board[0]!.by, "qa");
});

test("hardening: JobStore runaway guard caps the pending queue", async () => {
  const store = new JobStore(new FakeKV(), { maxPending: 3 });
  for (let i = 0; i < 3; i++) await store.enqueue("task " + i);
  await assert.rejects(() => store.enqueue("overflow"), /queue full/);
});

test("hardening: JobStore rejects empty goal + truncates oversized", async () => {
  const store = new JobStore(new FakeKV(), { maxGoalChars: 50 });
  await assert.rejects(() => store.enqueue("   "), /empty goal/);
  const j = await store.enqueue("x".repeat(500));
  assert.equal(j.goal.length, 50);
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
