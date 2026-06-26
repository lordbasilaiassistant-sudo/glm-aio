// Persistent memory for agents. Two backends behind one interface:
//   - InMemoryStore: process-local (tests, local long-lived agents)
//   - KVMemoryStore: Cloudflare KV (survives restarts, shared across Worker invocations)
// Memory is keyed by sessionId so many independent agents/conversations coexist.
import type { Message } from "./types";

export interface MemoryStore {
  load(sessionId: string): Promise<Message[]>;
  save(sessionId: string, messages: Message[]): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

/** Minimal shape of a Cloudflare KV namespace (or any compatible KV). */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list?(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string }[]; cursor?: string; list_complete?: boolean }>;
}

export class InMemoryStore implements MemoryStore {
  private map = new Map<string, Message[]>();

  async load(sessionId: string): Promise<Message[]> {
    const v = this.map.get(sessionId);
    return v ? structuredClone(v) : [];
  }
  async save(sessionId: string, messages: Message[]): Promise<void> {
    this.map.set(sessionId, structuredClone(messages));
  }
  async clear(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }
}

export interface KVMemoryOptions {
  /** key prefix in KV. Default "sess:". */
  prefix?: string;
  /** expire stored conversations after this many seconds. */
  ttlSeconds?: number;
  /** keep only the last N messages when saving (bounds growth). */
  maxMessages?: number;
}

export class KVMemoryStore implements MemoryStore {
  constructor(
    private kv: KVLike,
    private opts: KVMemoryOptions = {},
  ) {}

  private key(sessionId: string): string {
    return `${this.opts.prefix ?? "sess:"}${sessionId}`;
  }

  async load(sessionId: string): Promise<Message[]> {
    const raw = await this.kv.get(this.key(sessionId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Message[]) : [];
    } catch {
      return [];
    }
  }

  async save(sessionId: string, messages: Message[]): Promise<void> {
    let msgs = messages;
    const max = this.opts.maxMessages;
    if (max && msgs.length > max) msgs = msgs.slice(-max);
    const opts = this.opts.ttlSeconds ? { expirationTtl: this.opts.ttlSeconds } : undefined;
    await this.kv.put(this.key(sessionId), JSON.stringify(msgs), opts);
  }

  async clear(sessionId: string): Promise<void> {
    await this.kv.delete(this.key(sessionId));
  }
}
