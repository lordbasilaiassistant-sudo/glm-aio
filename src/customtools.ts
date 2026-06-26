// Self-authored tools — the company extends its OWN capabilities. A toolsmith proposes a
// tool (a pure JS function body of `args` -> return value), the company TESTS it against
// concrete cases, and only tools whose tests all pass become `verified` and usable.
//
// Execution note: this runs the body via `new Function`, which works in Node (local
// authoring/testing) but is BLOCKED in the Cloudflare Workers runtime (no eval). So the
// store lives in KV (Worker can read/write defs), but running/testing happens in a Node
// runner. Keeping that boundary explicit here.
import type { KVLike } from "./memory";
import { nowIso } from "./util";

export interface CustomTool {
  name: string;
  description: string;
  /** JSON schema for args. */
  parameters: Record<string, unknown>;
  /** function body: receives `args`, returns a value. e.g. "return args.a + args.b;" */
  body: string;
  createdBy: string;
  createdAt: string;
  verified: boolean;
  lastTest?: { passed: number; failed: number; at: string };
}

export interface TestCase {
  args: unknown;
  expect: unknown;
}

const KEY = "tools:custom";
const NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;

export class CustomToolStore {
  constructor(private kv: KVLike) {}

  async all(): Promise<CustomTool[]> {
    const raw = await this.kv.get(KEY);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as CustomTool[]) : [];
    } catch {
      return [];
    }
  }

  async get(name: string): Promise<CustomTool | undefined> {
    return (await this.all()).find((t) => t.name === name);
  }

  async verified(): Promise<CustomTool[]> {
    return (await this.all()).filter((t) => t.verified);
  }

  async save(t: CustomTool): Promise<void> {
    const all = await this.all();
    const i = all.findIndex((x) => x.name === t.name);
    if (i >= 0) all[i] = t;
    else all.push(t);
    await this.kv.put(KEY, JSON.stringify(all));
  }

  /** Register a new (unverified) tool. Throws on a bad name. */
  async create(def: { name: string; description: string; parameters: Record<string, unknown>; body: string; createdBy?: string }): Promise<CustomTool> {
    if (!NAME_RE.test(def.name)) throw new Error(`invalid tool name "${def.name}" (use a-z, 0-9, _, 3-41 chars)`);
    if ((await this.all()).length >= 100) throw new Error("tool limit reached (100)");
    if ((def.body?.length ?? 0) > 16_000) throw new Error("tool body too large (max 16KB)");
    if ((def.description?.length ?? 0) > 1_000) throw new Error("description too large (max 1KB)");
    // defense-in-depth: the body is run via new Function on the Node runner — block obvious escapes
    if (/\b(require|process|child_process|import|globalThis|fetch|eval|Function|constructor)\b/.test(def.body ?? "")) {
      throw new Error("forbidden token in tool body (must be a pure function of args)");
    }
    const t: CustomTool = {
      name: def.name,
      description: def.description,
      parameters: def.parameters ?? { type: "object", properties: {} },
      body: def.body,
      createdBy: def.createdBy ?? "toolsmith",
      createdAt: nowIso(),
      verified: false,
    };
    await this.save(t);
    return t;
  }
}

/** Run a custom tool's body as a pure function of args. (Node only — Workers block eval.) */
export function runCustomTool(tool: CustomTool, args: unknown): unknown {
  // eslint-disable-next-line no-new-func
  const fn = new Function("args", `"use strict";\n${tool.body}`) as (a: unknown) => unknown;
  return fn(args);
}

export interface TestReport {
  passed: number;
  failed: number;
  results: Array<{ ok: boolean; got?: unknown; error?: string }>;
}

/** Run a tool against test cases; deep-equal (via JSON) the result to each `expect`. */
export function testCustomTool(tool: CustomTool, cases: TestCase[]): TestReport {
  const results = cases.map((c) => {
    try {
      const got = runCustomTool(tool, c.args);
      return { ok: JSON.stringify(got) === JSON.stringify(c.expect), got };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results };
}

/** Test a tool and, if every case passes, mark it verified in the store. Returns the report. */
export async function verifyTool(store: CustomToolStore, name: string, cases: TestCase[]): Promise<TestReport & { verified: boolean }> {
  const tool = await store.get(name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  const report = testCustomTool(tool, cases);
  const verified = cases.length > 0 && report.failed === 0;
  tool.verified = verified;
  tool.lastTest = { passed: report.passed, failed: report.failed, at: nowIso() };
  await store.save(tool);
  return { ...report, verified };
}
