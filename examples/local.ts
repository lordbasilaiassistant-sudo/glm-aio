// Minimal local usage. Run: ZAI_API_KEY=... npx tsx examples/local.ts
import { GLMClient } from "../src/index";

const client = new GLMClient({ logLevel: "info" }); // reads ZAI_API_KEY from env

const res = await client.chat([
  { role: "system", content: "You are terse." },
  { role: "user", content: "Give me one fact about octopuses." },
]);

console.log("Answer:", res.content);
console.log("Tokens:", res.usage);
