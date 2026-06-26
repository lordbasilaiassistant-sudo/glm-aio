// Small shared utilities (no deps; Node + Workers safe).

/** Generate a unique id, preferring crypto.randomUUID where available. */
export function genId(prefix = ""): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return prefix + c.randomUUID();
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** ISO timestamp (UTC). Wrapped so call sites read clearly. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** GLM-flash tends to prepend a stray newline to final answers; strip only leading newlines. */
export function cleanText(s: string): string {
  return s.replace(/^\n+/, "");
}
