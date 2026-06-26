// glm-aio — all-in-one harness for GLM (z.ai) models. Public API.
export { GLMClient, type GLMClientConfig } from "./client";
export { Assistant, type AssistantConfig, type AskResult } from "./assistant";
export { ToolRegistry, tool, type ToolDef, type ToolContext } from "./tools";
export {
  type MemoryStore,
  type KVLike,
  InMemoryStore,
  KVMemoryStore,
  type KVMemoryOptions,
} from "./memory";
export {
  JobStore,
  type Job,
  type JobStatus,
  type JobOutcome,
  type JobRunner,
} from "./jobs";
export { MessageBus, type BusMessage, type MessageBusOptions } from "./bus";
export { COMPANY, charterFor, systemFor, type AgentCharter } from "./agents";
export { genId, nowIso, cleanText } from "./util";
export { Tracer, redact, type DebugHooks, type TracerConfig, type Counters } from "./debug";
export {
  MODELS,
  DEFAULT_MODEL,
  FREE_MODELS,
  getModel,
  isFree,
  assertModelAllowed,
  estimateCost,
  type ModelInfo,
} from "./models";
export {
  GLMError,
  classifyHttp,
  classifyThrown,
  type GLMErrorKind,
} from "./errors";
export type {
  Role,
  Message,
  ToolCall,
  ToolSchema,
  ToolChoice,
  Usage,
  ChatOptions,
  ChatResult,
  StreamEvent,
  LogLevel,
  SpanData,
} from "./types";

/** Quick helper: one-shot question with sensible defaults (free model, thinking off). */
export async function ask(prompt: string, cfg: import("./client").GLMClientConfig = {}): Promise<string> {
  const { GLMClient } = await import("./client");
  const client = new GLMClient(cfg);
  const res = await client.chat([{ role: "user", content: prompt }]);
  return res.content;
}
