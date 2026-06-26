// Tool registry + execution. Tools are plain functions with a JSON-schema signature.
// The Assistant runs the model→tool→model loop; this module owns registration + dispatch.
import type { ToolSchema } from "./types";

export interface ToolContext {
  /** free-form state threaded through a run (e.g. KV, user id, abort signal). */
  [k: string]: unknown;
}

export interface ToolDef<A = any> {
  name: string;
  description?: string;
  /** JSON schema for the arguments object. */
  parameters: Record<string, unknown>;
  handler: (args: A, ctx: ToolContext) => Promise<unknown> | unknown;
}

/** Convenience constructor (keeps inference tidy). */
export function tool<A = any>(def: ToolDef<A>): ToolDef<A> {
  return def;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  constructor(defs: ToolDef[] = []) {
    for (const d of defs) this.register(d);
  }

  register(def: ToolDef): this {
    this.tools.set(def.name, def);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get size(): number {
    return this.tools.size;
  }

  /** Schemas to hand to the model. */
  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  /** Execute a tool by name with raw JSON-string args. Always returns a string result. */
  async execute(name: string, argsJson: string, ctx: ToolContext = {}): Promise<string> {
    const def = this.tools.get(name);
    if (!def) return JSON.stringify({ error: `unknown tool: ${name}` });
    let args: unknown = {};
    if (argsJson && argsJson.trim()) {
      try {
        args = JSON.parse(argsJson);
      } catch {
        return JSON.stringify({ error: `invalid JSON arguments for ${name}: ${argsJson.slice(0, 120)}` });
      }
    }
    try {
      const out = await def.handler(args, ctx);
      return typeof out === "string" ? out : JSON.stringify(out ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: `tool "${name}" threw: ${msg}` });
    }
  }
}
