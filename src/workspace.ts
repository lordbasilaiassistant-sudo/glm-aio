// Shared company workspace — KV-backed docs + a board, so the layered employees
// collaborate on persistent shared state (the bus is for transient messages; the
// workspace is for durable shared documents the whole company reads/writes).
import type { KVLike } from "./memory";
import { nowIso, genId } from "./util";

export interface BoardNote {
  id: string;
  by: string;
  text: string;
  at: string;
}

export interface WorkspaceOptions {
  prefix?: string;
  boardLimit?: number;
}

export class Workspace {
  constructor(
    private kv: KVLike,
    private opts: WorkspaceOptions = {},
  ) {}

  private p(): string {
    return this.opts.prefix ?? "ws:";
  }
  private docKey(key: string): string {
    return `${this.p()}doc:${key}`;
  }
  private boardKey(): string {
    return `${this.p()}board`;
  }

  async readDoc(key: string): Promise<string | null> {
    return this.kv.get(this.docKey(key));
  }

  async writeDoc(key: string, content: string): Promise<void> {
    await this.kv.put(this.docKey(key), content);
  }

  /** Post a short note to the shared board (decisions, handoffs, status). */
  async postNote(by: string, text: string): Promise<BoardNote> {
    const note: BoardNote = { id: genId("note_"), by, text, at: nowIso() };
    const board = await this.board();
    board.push(note);
    await this.kv.put(this.boardKey(), JSON.stringify(board.slice(-(this.opts.boardLimit ?? 100))));
    return note;
  }

  async board(limit = 30): Promise<BoardNote[]> {
    const raw = await this.kv.get(this.boardKey());
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as BoardNote[]).slice(-limit).reverse() : [];
    } catch {
      return [];
    }
  }

  /** Keys of all shared docs — the "what's where" index. Needs a KV that supports list(). */
  async listDocKeys(limit = 100): Promise<string[]> {
    if (!this.kv.list) return [];
    const prefix = `${this.p()}doc:`;
    const res = await this.kv.list({ prefix, limit });
    return res.keys.map((k) => k.name.slice(prefix.length));
  }
}
