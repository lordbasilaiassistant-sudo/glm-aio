// Model registry. `free` is the load-bearing field: the client refuses to call a
// non-free model unless allowPaid is explicitly set, so the harness can never spend
// money by accident. Verified live on 2026-06-26 against our key:
//   FREE/200: glm-4.5-flash
//   429/1113 (needs paid balance): glm-4.5, glm-4.5-air, glm-4.6, glm-4.7,
//                                   glm-5, glm-5-turbo, glm-5.1, glm-5.2, glm-4.5-airx
import { GLMError } from "./errors";

export interface ModelInfo {
  id: string;
  /** callable on a zero-balance key. */
  free: boolean;
  /** supports chain-of-thought (reasoning_content). */
  reasoning: boolean;
  /** USD per 1M input tokens (0 for free). */
  inputPer1M: number;
  /** USD per 1M output tokens (0 for free). */
  outputPer1M: number;
  note?: string;
}

export const MODELS: Record<string, ModelInfo> = {
  "glm-4.5-flash": { id: "glm-4.5-flash", free: true, reasoning: true, inputPer1M: 0, outputPer1M: 0, note: "Only confirmed-free model. Default workhorse." },
  "glm-4.5": { id: "glm-4.5", free: false, reasoning: true, inputPer1M: 0.6, outputPer1M: 2.2 },
  "glm-4.5-air": { id: "glm-4.5-air", free: false, reasoning: true, inputPer1M: 0.2, outputPer1M: 1.1 },
  "glm-4.6": { id: "glm-4.6", free: false, reasoning: true, inputPer1M: 0.6, outputPer1M: 2.2 },
  "glm-4.7": { id: "glm-4.7", free: false, reasoning: true, inputPer1M: 0.6, outputPer1M: 2.2 },
  "glm-5": { id: "glm-5", free: false, reasoning: true, inputPer1M: 1.0, outputPer1M: 3.0 },
  "glm-5-turbo": { id: "glm-5-turbo", free: false, reasoning: true, inputPer1M: 0.5, outputPer1M: 1.5 },
  "glm-5.1": { id: "glm-5.1", free: false, reasoning: true, inputPer1M: 1.0, outputPer1M: 3.0 },
  "glm-5.2": { id: "glm-5.2", free: false, reasoning: true, inputPer1M: 1.0, outputPer1M: 3.0 },
};

export const DEFAULT_MODEL = "glm-4.5-flash";

export const FREE_MODELS = Object.values(MODELS)
  .filter((m) => m.free)
  .map((m) => m.id);

export function getModel(id: string): ModelInfo | undefined {
  return MODELS[id];
}

export function isFree(id: string): boolean {
  // Unknown models are treated as NOT free — fail safe toward not spending money.
  return MODELS[id]?.free ?? false;
}

/** Throws unless `model` is free or paid models are explicitly allowed. */
export function assertModelAllowed(model: string, allowPaid: boolean): void {
  if (allowPaid) return;
  if (isFree(model)) return;
  throw new GLMError(
    "config",
    `Refusing to call paid model "${model}" with allowPaid=false. ` +
      `Free models: ${FREE_MODELS.join(", ")}. ` +
      `Set allowPaid:true (and add balance to the key) to override.`,
    { retryable: false },
  );
}

/** Estimate USD cost for a usage record on a given model (0 for free models). */
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const m = MODELS[model];
  if (!m) return 0;
  return (promptTokens / 1e6) * m.inputPer1M + (completionTokens / 1e6) * m.outputPer1M;
}
