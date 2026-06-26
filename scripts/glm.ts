// glm — call GLM from any shell. Free local calls, agent mode, or dispatch to the live Worker.
//
//   npx tsx scripts/glm.ts "explain X in one line"        # local chat (free)
//   npx tsx scripts/glm.ts --think "hard reasoning task"  # enable thinking
//   npx tsx scripts/glm.ts --agent "use tools to ..."     # local agent w/ built-in tools
//   npx tsx scripts/glm.ts --stream "tell a short story"  # stream tokens
//   npx tsx scripts/glm.ts --remote "ping"                # call deployed Worker /ask
//   npx tsx scripts/glm.ts --job "do this later"          # enqueue an autonomous job on the Worker
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GLMClient, Assistant } from "../src/index";
import { builtinTools } from "../worker/tools";

function fromEnvFile(file: string, key: string): string | undefined {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${key}=(.+)\\s*$`));
      if (m && m[1]) return m[1].trim();
    }
  } catch { /* missing file */ }
  return undefined;
}

function loadKey(): string {
  return process.env.ZAI_API_KEY ?? fromEnvFile(join(homedir(), ".claude", "secrets", "zai.env"), "ZAI_API_KEY") ?? "";
}

function remoteConfig() {
  const f = join(homedir(), ".claude", "secrets", "finalplan-glm-aio.env");
  return {
    url: process.env.GLM_WORKER_URL ?? fromEnvFile(f, "WORKER_URL") ?? "https://glm-aio.thryx.workers.dev",
    token: process.env.GLM_GATEWAY_TOKEN ?? fromEnvFile(f, "GATEWAY_TOKEN") ?? "",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const prompt = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!prompt) {
    console.error('usage: glm [--think|--agent|--stream|--remote|--job] "your prompt"');
    process.exit(1);
  }
  const thinking = flags.has("--think");

  if (flags.has("--remote") || flags.has("--job")) {
    const { url, token } = remoteConfig();
    const path = flags.has("--job") ? "/jobs" : "/ask";
    const payload = flags.has("--job") ? { goal: prompt } : { input: prompt, thinking };
    const resp = await fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
    console.log(JSON.stringify(await resp.json(), null, 2));
    return;
  }

  const apiKey = loadKey();
  if (!apiKey) { console.error("no ZAI_API_KEY"); process.exit(1); }

  if (flags.has("--stream")) {
    const client = new GLMClient({ apiKey, logLevel: "silent" });
    for await (const e of client.stream([{ role: "user", content: prompt }], { thinking })) {
      if (e.type === "content") process.stdout.write(e.delta);
    }
    process.stdout.write("\n");
    return;
  }

  if (flags.has("--agent")) {
    const assistant = new Assistant({ apiKey, logLevel: "silent", tools: builtinTools() });
    const r = await assistant.ask(prompt, { thinking });
    console.log(r.text);
    if (r.toolRuns.length) console.error(`\n[tools: ${r.toolRuns.map((t) => t.name).join(", ")}]`);
    return;
  }

  const client = new GLMClient({ apiKey, logLevel: "silent" });
  const r = await client.chat([{ role: "user", content: prompt }], { thinking });
  console.log(r.content.replace(/^\n+/, ""));
}

main().catch((e) => { console.error("error:", e?.message ?? e); process.exit(1); });
