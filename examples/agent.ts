// Assistant with tools. Run: ZAI_API_KEY=... npx tsx examples/agent.ts
import { Assistant, tool } from "../src/index";

const assistant = new Assistant({
  name: "Aria",
  logLevel: "info",
  tools: [
    tool({
      name: "get_time",
      description: "Current UTC time.",
      parameters: { type: "object", properties: {} },
      handler: () => ({ utc: new Date().toISOString() }),
    }),
    tool({
      name: "word_count",
      description: "Count words in a string.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      handler: (a: { text: string }) => ({ words: a.text.trim().split(/\s+/).filter(Boolean).length }),
    }),
  ],
});

const r = await assistant.ask("What time is it (UTC), and how many words are in 'the quick brown fox'?");
console.log("\nFinal:", r.text);
console.log("Steps:", r.steps, "| Tools:", r.toolRuns.map((t) => t.name).join(", "));
console.log("Usage:", r.usage);
