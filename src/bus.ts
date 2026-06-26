// Internal message bus — how agents in the company communicate. KV-backed, so it
// works across stateless Worker invocations and survives restarts. This is the
// "secure API they talk through" (authed at the Worker edge) — NOT git-as-chat.
//
// Two surfaces: a global `feed` (company activity, newest first) and per-role
// `inbox`es (addressed messages). An agent posts a message; recipients read their
// inbox on their turn.
import type { KVLike } from "./memory";
import { genId, nowIso } from "./util";

export interface BusMessage {
  id: string;
  /** sender role/agent id. */
  from: string;
  /** recipient role, or "all" for broadcast. */
  to: string;
  /** "task" | "result" | "alert" | "note" | "handoff" ... */
  kind: string;
  body: string;
  at: string;
  /** optional correlation (e.g. job id / order id). */
  ref?: string;
}

export interface MessageBusOptions {
  feedLimit?: number;
  inboxLimit?: number;
  ttlSeconds?: number;
}

export class MessageBus {
  constructor(
    private kv: KVLike,
    private opts: MessageBusOptions = {},
  ) {}

  private feedKey(): string { return "bus:feed"; }
  private inboxKey(role: string): string { return `bus:inbox:${role}`; }

  async post(m: Omit<BusMessage, "id" | "at">): Promise<BusMessage> {
    const msg: BusMessage = { id: genId("msg_"), at: nowIso(), ...m };
    await this.append(this.feedKey(), msg, this.opts.feedLimit ?? 120);
    if (m.to && m.to !== "all") {
      await this.append(this.inboxKey(m.to), msg, this.opts.inboxLimit ?? 120);
    }
    return msg;
  }

  /** Company activity, newest first. */
  async feed(limit = 30): Promise<BusMessage[]> {
    return (await this.read(this.feedKey())).slice(-limit).reverse();
  }

  /** Messages addressed to a role, newest first. */
  async inbox(role: string, limit = 30): Promise<BusMessage[]> {
    return (await this.read(this.inboxKey(role))).slice(-limit).reverse();
  }

  private async append(key: string, msg: BusMessage, cap: number): Promise<void> {
    const arr = await this.read(key);
    arr.push(msg);
    const opts = this.opts.ttlSeconds ? { expirationTtl: this.opts.ttlSeconds } : undefined;
    await this.kv.put(key, JSON.stringify(arr.slice(-cap)), opts);
  }

  private async read(key: string): Promise<BusMessage[]> {
    const raw = await this.kv.get(key);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as BusMessage[]) : [];
    } catch {
      return [];
    }
  }
}
