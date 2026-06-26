// Tests for self-authored tools — proves an agent can register a tool, have it tested,
// and only have it marked verified when its test cases actually pass. (Node: eval works.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { CustomToolStore, runCustomTool, testCustomTool, verifyTool } from "../src/customtools";
import type { KVLike } from "../src/memory";

class FakeKV implements KVLike {
  m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}

test("custom tool: create -> run -> verify happy path", async () => {
  const store = new CustomToolStore(new FakeKV());
  await store.create({
    name: "celsius_to_f",
    description: "Convert Celsius to Fahrenheit",
    parameters: { type: "object", properties: { c: { type: "number" } }, required: ["c"] },
    body: "return Math.round(args.c * 9/5 + 32);",
  });
  const tool = (await store.get("celsius_to_f"))!;
  assert.equal(tool.verified, false); // unverified until tested
  assert.equal(runCustomTool(tool, { c: 100 }), 212);

  const report = await verifyTool(store, "celsius_to_f", [
    { args: { c: 0 }, expect: 32 },
    { args: { c: 100 }, expect: 212 },
    { args: { c: 37 }, expect: 99 },
  ]);
  assert.equal(report.failed, 0);
  assert.equal(report.verified, true);
  assert.equal((await store.get("celsius_to_f"))!.verified, true); // persisted
});

test("custom tool: a buggy tool fails its tests and is NOT verified", async () => {
  const store = new CustomToolStore(new FakeKV());
  await store.create({ name: "add_buggy", description: "adds (wrong)", parameters: {}, body: "return args.a - args.b;" });
  const report = await verifyTool(store, "add_buggy", [{ args: { a: 2, b: 3 }, expect: 5 }]);
  assert.equal(report.verified, false);
  assert.ok(report.failed >= 1);
  assert.equal((await store.get("add_buggy"))!.verified, false);
});

test("custom tool: a throwing body is caught, not crashing the tester", () => {
  const report = testCustomTool(
    { name: "boom", description: "", parameters: {}, body: "throw new Error('nope');", createdBy: "t", createdAt: "", verified: false },
    [{ args: {}, expect: 1 }],
  );
  assert.equal(report.failed, 1);
  assert.match(report.results[0]!.error!, /nope/);
});

test("custom tool: bad names are rejected", async () => {
  const store = new CustomToolStore(new FakeKV());
  await assert.rejects(() => store.create({ name: "Bad Name!", description: "", parameters: {}, body: "return 1;" }), /invalid tool name/);
});

test("custom tool: rejects dangerous body tokens + oversized body (hardening)", async () => {
  const store = new CustomToolStore(new FakeKV());
  await assert.rejects(() => store.create({ name: "evil_tool", description: "", parameters: {}, body: "return require('fs').readFileSync('/etc/passwd');" }), /forbidden token/);
  await assert.rejects(() => store.create({ name: "fetch_tool", description: "", parameters: {}, body: "return fetch('http://evil');" }), /forbidden token/);
  await assert.rejects(() => store.create({ name: "huge_tool", description: "", parameters: {}, body: "x".repeat(20_000) }), /too large/);
});

test("custom tool: only verified tools surface to the company", async () => {
  const store = new CustomToolStore(new FakeKV());
  await store.create({ name: "good_tool", description: "", parameters: {}, body: "return 1;" });
  await store.create({ name: "untested_tool", description: "", parameters: {}, body: "return 2;" });
  await verifyTool(store, "good_tool", [{ args: {}, expect: 1 }]);
  const verified = await store.verified();
  assert.equal(verified.length, 1);
  assert.equal(verified[0]!.name, "good_tool");
});
