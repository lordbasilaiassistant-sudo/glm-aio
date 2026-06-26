// Financial-stage-aware company strategy. The Director reads this each cycle and picks
// priorities matched to where the company ACTUALLY is — a $0 bootstrap behaves nothing
// like a growth-stage company. Stage is derived from real state (revenue + validated
// mechanics), never assumed.

export type Stage = "bootstrap" | "validating" | "first_revenue" | "growth";

export interface CompanyState {
  revenueUsd: number;
  costsUsd: number;
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
  return { revenueUsd: 0, costsUsd: 0, validatedMechanics: [] };
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
    focus: "Find ONE mechanic worth validating. Spend nothing. Build the harness, not products.",
    priorities: [
      "pick one candidate with BUILT-IN distribution (a marketplace where money already moves)",
      "design a $0 falsification test for it",
      "improve the company's own tools + structure",
    ],
    guardrails: ["no capital spent", "no scaling anything unvalidated", "one bet at a time", "no oversaturated slop"],
    activeRoles: ["director", "researcher", "builder", "qa"],
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
