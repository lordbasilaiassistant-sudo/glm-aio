// Live end-to-end smoke test of the BUILT harness against the real GLM API.
// Loads the key from ZAI_API_KEY, else from ~/.claude/secrets/zai.env. Never prints it.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GLMClient, Assistant, tool } from "../src/index";

function loadKey(): string {
  if (process.env.ZAI_API_KEY) return process.env.ZAI_API_KEY;
  const p = join(homedir(), ".claude", "secrets", "zai.env");
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*ZAI_API_KEY=(.+)\s*$/);
    if (m && m[1]) return m[1].trim();
  }
  throw new Error("No ZAI_API_KEY found");
}

async function main() {
  const apiKey = loadKey();
  console.log("== glm-aio live smoke ==");
  const client = new GLMClient({ apiKey, logLevel: "info" });

  // 1) fast path (thinking off)
  console.log("\n[1] chat, thinking OFF");
  const fast = await client.chat([{ role: "user", content: "Reply with exactly: PONG" }], { maxTokens: 16 });
  console.log("   content:", JSON.stringify(fast.content), "| latency:", fast.trace.latencyMs + "ms");

  // 2) reasoning path (thinking on)
  console.log("\n[2] chat, thinking ON (17*23)");
  const reason = await client.chat([{ role: "user", content: "What is 17*23? Number only." }], { thinking: true, maxTokens: 1500 });
  console.log("   content:", JSON.stringify(reason.content), "| reasoning chars:", reason.reasoning.length, "| reasoning tok:", reason.usage.reasoning_tokens);

  // 3) streaming
  console.log("\n[3] streaming");
  let streamed = "";
  const gen = client.stream([{ role: "user", content: "Count 1 to 5 with spaces." }], { maxTokens: 64 });
  let n = await gen.next();
  while (!n.done) {
    if (n.value.type === "content") streamed += n.value.delta;
    n = await gen.next();
  }
  console.log("   streamed:", JSON.stringify(streamed.slice(0, 60)));

  // 4) assistant + tool loop
  console.log("\n[4] assistant tool loop");
  const assistant = new Assistant({
    apiKey,
    logLevel: "warn",
    tools: [
      tool({
        name: "multiply",
        description: "Multiply two integers.",
        parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
        handler: (x: { a: number; b: number }) => ({ product: x.a * x.b }),
      }),
    ],
  });
  const ans = await assistant.ask("Use the multiply tool to compute 17 times 23, then tell me the result.");
  console.log("   answer:", JSON.stringify(ans.text));
  console.log("   tool runs:", ans.toolRuns.map((t) => `${t.name}(${t.args})->${t.result}`).join(", "));

  // 5) money guard
  console.log("\n[5] money guard (paid model must throw)");
  try {
    await client.chat([{ role: "user", content: "hi" }], { model: "glm-4.6" });
    console.log("   FAIL: paid model was not blocked");
  } catch (e: any) {
    console.log("   blocked as expected:", e.kind, "-", e.message.slice(0, 60));
  }

  console.log("\n== trace summary ==");
  console.log(JSON.stringify(client.tracer.summary(), null, 2));
  console.log("\nOK");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
