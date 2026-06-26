// Affiliate rail — the small, ALWAYS-DISCLOSED referral tool. Only links that
// actually earn for us, each with a context fence so it's never spammed where it
// doesn't fit. Verified live 2026-06-26 (both HTTP 200).
//
// Rules baked in: z.ai only on dev/AI-facing things; ElevenLabs only on
// voice/audio/video; disclose as a referral, never "a discount from us"; if
// nothing fits the context, return NOTHING (don't force a link).
import { tool, type ToolDef } from "../src/tools";

export interface Affiliate {
  id: string;
  program: string;
  url: string;
  fits: string[];
  disclosedLine: string;
  earns: string;
  verified: string;
}

export const AFFILIATES: Affiliate[] = [
  {
    id: "zai",
    program: "z.ai GLM Coding Plan",
    url: "https://z.ai/subscribe?ic=BWTG6TRYYQ",
    fits: ["dev", "ai", "coding", "code", "agent", "llm", "developer", "api", "mcp"],
    disclosedLine: "Runs on free GLM via z.ai — want the bigger models? Referral (helps fund our compute): https://z.ai/subscribe?ic=BWTG6TRYYQ",
    earns: "z.ai credits",
    verified: "2026-06-26 · HTTP 200",
  },
  {
    id: "elevenlabs",
    program: "ElevenLabs (AI voice / TTS)",
    url: "https://try.elevenlabs.io/iv7rr0dm8qav",
    fits: ["voice", "audio", "tts", "speech", "video", "podcast", "narration", "sound"],
    disclosedLine: "Voice by ElevenLabs (referral link — supports us): https://try.elevenlabs.io/iv7rr0dm8qav",
    earns: "cash (PartnerStack)",
    verified: "2026-06-26 · HTTP 200 → PartnerStack tracker",
  },
];

/** Return affiliates whose context fence matches. Empty array = add no link (correct, common). */
export function affiliateFor(context: string): Affiliate[] {
  const c = (context || "").toLowerCase();
  return AFFILIATES.filter((a) => a.fits.some((k) => c.includes(k)));
}

/** Tool the agent calls when producing public content, to get the right disclosed footer (or none). */
export function affiliateTool(): ToolDef {
  return tool({
    name: "affiliate_footer",
    description:
      "Get the correct DISCLOSED affiliate footer for a piece of content/project, or none if no link fits. " +
      "Pass a context describing the project (e.g. 'dev CLI tool', 'podcast generator', 'parenting app'). " +
      "Only returns a link where it genuinely fits; returns empty for normie/unrelated contexts (do NOT add one then).",
    parameters: {
      type: "object",
      properties: { context: { type: "string", description: "what the content/project is about" } },
      required: ["context"],
    },
    handler: (a: { context: string }) => {
      const matches = affiliateFor(a.context);
      if (!matches.length) return { footer: "", note: "No affiliate fits this context — do not add a referral link here." };
      return { footers: matches.map((m) => m.disclosedLine), programs: matches.map((m) => m.program) };
    },
  });
}
