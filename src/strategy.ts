// Financial-stage-aware company strategy. The Director reads this each cycle and picks
// priorities matched to where the company ACTUALLY is — a $0 bootstrap behaves nothing
// like a growth-stage company. Stage is derived from real state (revenue + validated
// mechanics), never assumed.

export type Stage = "bootstrap" | "validating" | "first_revenue" | "growth";

export interface CompanyState {
  revenueUsd: number;
  costsUsd: number;
  /**
   * Affiliate/sponsor credits funding the company's compute (z.ai etc.). This is the
   * "investment" — Anthony + Claude fund compute, sponsors (affiliate programs) top it up.
   * Becoming self-funding on compute (credits cover compute cost) is the FIRST goal,
   * before any external profit.
   */
  sponsorCreditsUsd: number;
  /** mechanics proven to actually earn (cite the proof when adding). */
  validatedMechanics: string[];
  updatedAt?: string;
}

export interface StagePlan {
  stage: Stage;
  focus: string;
  priorities: string[];
  guardrails: string[];
  /** which roles the company should be running at this stage. */
  activeRoles: string[];
}

export function defaultState(): CompanyState {
  return { revenueUsd: 0, costsUsd: 0, sponsorCreditsUsd: 0, validatedMechanics: [] };
}

/** Derive stage from real state — no guessing. */
export function inferStage(s: CompanyState): Stage {
  if (s.revenueUsd > 0 && s.revenueUsd >= 500) return "growth";
  if (s.revenueUsd > 0) return "first_revenue";
  if (s.validatedMechanics.length > 0) return "validating";
  return "bootstrap";
}

const PLANS: Record<Stage, StagePlan> = {
  bootstrap: {
    stage: "bootstrap",
    focus:
      "You run on compute funded by your investors (Anthony + Claude) and topped up by sponsors (affiliate programs). FIRST goal: get to self-funding on compute via sponsor credits, while finding ONE mechanic worth validating. Spend nothing. Build the harness, not products.",
    priorities: [
      "grow sponsor/affiliate credits (disclosed referral links where they fit) to self-fund compute",
      "pick one candidate with BUILT-IN distribution (a marketplace where money already moves)",
      "design a $0 falsification test for it; keep improving the company's own tools + structure",
    ],
    guardrails: ["no capital spent", "no scaling anything unvalidated", "one bet at a time", "no oversaturated slop", "affiliate links always disclosed, only where they fit"],
    activeRoles: ["director", "growth_manager", "researcher", "builder", "qa"],
  },
  validating: {
    stage: "validating",
    focus: "Run $0 tests to confirm BOTH demand and deliverable quality before listing anything.",
    priorities: [
      "run the cheapest demand probe (does money already change hands?)",
      "have the company produce one real sample and verify it",
      "kill or greenlight strictly on cited evidence",
    ],
    guardrails: ["no listing until demand AND quality both pass", "cite proof, never assume"],
    activeRoles: ["director", "eng_manager", "builder", "qa", "researcher"],
  },
  first_revenue: {
    stage: "first_revenue",
    focus: "Double down on the ONE validated mechanic. Reinvest earnings/credits into better models (the flywheel).",
    priorities: [
      "increase output on the working mechanic",
      "automate the delivery + maintenance loop so it needs no human",
      "track unit economics honestly",
    ],
    guardrails: ["don't chase new mechanics yet", "reinvest before expanding"],
    activeRoles: ["director", "eng_manager", "growth_manager", "builder", "data", "qa", "writer", "scribe"],
  },
  growth: {
    stage: "growth",
    focus: "Scale output and distribution; expand the org; fund harder capabilities.",
    priorities: [
      "scale output on proven lines",
      "broaden distribution (genuine participation, gated — never spam)",
      "add new lines only once validated",
    ],
    guardrails: ["protect the core mechanic", "outreach stays genuine + human/Claude-gated"],
    activeRoles: ["all"],
  },
};

export function strategyFor(stage: Stage): StagePlan {
  return PLANS[stage];
}
