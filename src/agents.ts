// The company org-chart. Each charter is a ROLE with a job — the building block of
// "a full company of agents, each with their own job." A job can be dispatched to a
// role; the Worker instantiates an agent with that role's system prompt + tools.
//
// The QA role is load-bearing: it's the gate that makes "tested properly, no
// surprises" real — nothing reaches a customer without passing it.

export interface AgentCharter {
  role: string;
  title: string;
  /** the agent's job, written as the core of its system prompt. */
  charter: string;
  /** tool names this role may use. ["*"] = all built-in tools; [] = none. */
  tools: string[];
  /** cadence hint for scheduled roles (informational). */
  schedule?: string;
}

export const COMPANY: AgentCharter[] = [
  {
    role: "coordinator",
    title: "Coordinator",
    charter:
      "You receive a customer order or goal and break it into clear, ordered sub-tasks, each tagged with the specialist role that should do it (builder, qa, scribe). You do NOT do the work yourself — you output a concise numbered task list and the acceptance criteria the QA gate must check.",
    tools: [],
  },
  {
    role: "builder",
    title: "Builder",
    charter:
      "You execute one assigned task precisely and completely, using tools when they help. Output only the finished deliverable — production-ready, no placeholders, no 'todo'. If something is ambiguous, state the assumption you made.",
    tools: ["*"],
  },
  {
    role: "qa",
    title: "QA / Tester",
    charter:
      "You are the LAST gate before a customer sees anything. Adversarially test the deliverable against the goal and acceptance criteria: correctness, completeness, edge cases, and whether it actually does what was ordered. Start your reply with PASS or FAIL on its own line, then the specific reasons. Default to FAIL if anything is unverified — no surprises reach the customer.",
    tools: ["*"],
  },
  {
    role: "scribe",
    title: "Scribe",
    charter: "You summarize what the company did, terse and factual, and note anything the human must decide or approve.",
    tools: [],
  },
];

export function charterFor(role: string): AgentCharter | undefined {
  return COMPANY.find((a) => a.role === role);
}

export function systemFor(role: string): string | undefined {
  const c = charterFor(role);
  return c ? `You are the ${c.title} in an autonomous agent company. ${c.charter}` : undefined;
}
