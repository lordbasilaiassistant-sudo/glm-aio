// Built-in tools safe for the Workers runtime (no fs, no node APIs — fetch only).
import { tool, type ToolDef } from "../src/tools";
import { affiliateTool } from "./affiliates";

export function builtinTools(): ToolDef[] {
  return [
    affiliateTool(),
    tool({
      name: "current_time",
      description: "Get the current UTC date and time as an ISO string.",
      parameters: { type: "object", properties: {} },
      handler: () => ({ utc: new Date().toISOString() }),
    }),

    tool({
      name: "calculate",
      description: "Evaluate a basic arithmetic expression (+ - * / parentheses, numbers only).",
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: "e.g. (17*23)+4" } },
        required: ["expression"],
      },
      handler: (a: { expression: string }) => {
        const expr = String(a.expression ?? "");
        if (!/^[\d\s+\-*/().]+$/.test(expr)) return { error: "only numbers and + - * / ( ) allowed" };
        try {
          // Safe: input is restricted to arithmetic chars by the regex above.
          const value = Function(`"use strict"; return (${expr});`)();
          return { value };
        } catch {
          return { error: "could not evaluate expression" };
        }
      },
    }),

    tool({
      name: "http_get",
      description: "Fetch a URL (GET) and return status + truncated text body. Use for public APIs/pages.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          maxChars: { type: "number", description: "max body chars to return (default 2000)" },
        },
        required: ["url"],
      },
      handler: async (a: { url: string; maxChars?: number }) => {
        let u: URL;
        try {
          u = new URL(a.url);
        } catch {
          return { error: "invalid url" };
        }
        if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "only http(s) urls" };
        const resp = await fetch(u.toString(), { headers: { "user-agent": "glm-aio/0.1" } });
        const text = await resp.text();
        const max = a.maxChars ?? 2000;
        return { status: resp.status, contentType: resp.headers.get("content-type"), body: text.slice(0, max), truncated: text.length > max };
      },
    }),
  ];
}
