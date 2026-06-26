// Autonomous job queue — the "coworker" layer. Drop a goal; an agent works it
// off-PC (driven by the Worker cron) and persists the result. Backed by KV so
// jobs survive between Worker invocations.
import type { KVLike } from "./memory";
import { genId, nowIso } from "./util";

export type JobStatus = "pending" | "running" | "done" | "error";

export interface Job {
  id: string;
  goal: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  /** who/what queued it (e.g. "cli", "api", "claude"). */
  source?: string;
  result?: string;
  reasoning?: string;
  steps?: number;
  tools?: string[];
  usage?: Record<string, number>;
  /** role that worked the job (company assignment). */
  role?: string;
  /** QA gate verdict (PASS/FAIL + reasons) when the job requested testing. */
  qa?: string;
  error?: string;
  attempts: number;
  meta?: Record<string, unknown>;
}

/** What a runner returns after working a job. */
export interface JobOutcome {
  result: string;
  reasoning?: string;
  steps?: number;
  tools?: string[];
  usage?: Record<string, number>;
  role?: string;
  qa?: string;
}

export type JobRunner = (job: Job) => Promise<JobOutcome>;

const PENDING_KEY = "jobs:pending";
const RECENT_KEY = "jobs:recent";

export class JobStore {
  constructor(
    private kv: KVLike,
    private opts: { ttlSeconds?: number; maxAttempts?: number; recentLimit?: number } = {},
  ) {}

  private jobKey(id: string): string {
    return `job:${id}`;
  }

  async enqueue(goal: string, source = "api", meta?: Record<string, unknown>): Promise<Job> {
    const job: Job = {
      id: genId("job_"),
      goal,
      status: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source,
      attempts: 0,
      ...(meta ? { meta } : {}),
    };
    await this.put(job);
    const pending = await this.readList(PENDING_KEY);
    pending.push(job.id);
    await this.writeList(PENDING_KEY, pending);
    await this.trackRecent(job.id);
    return job;
  }

  async get(id: string): Promise<Job | null> {
    const raw = await this.kv.get(this.jobKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Job;
    } catch {
      return null;
    }
  }

  async pendingIds(): Promise<string[]> {
    return this.readList(PENDING_KEY);
  }

  async recent(limit = 20): Promise<Job[]> {
    const ids = (await this.readList(RECENT_KEY)).slice(-limit).reverse();
    const jobs = await Promise.all(ids.map((id) => this.get(id)));
    return jobs.filter((j): j is Job => j !== null);
  }

  /**
   * Process up to `max` pending jobs with the given runner. Returns processed jobs.
   * Single-consumer (the cron) so no locking needed. Failed jobs are marked "error".
   */
  async process(runner: JobRunner, max = 3): Promise<Job[]> {
    const pending = await this.readList(PENDING_KEY);
    if (pending.length === 0) return [];
    const take = pending.slice(0, max);
    const remaining = pending.slice(take.length);
    // Remove taken ids up front so a crash can't reprocess them forever.
    await this.writeList(PENDING_KEY, remaining);

    const done: Job[] = [];
    for (const id of take) {
      const job = await this.get(id);
      if (!job) continue;
      job.status = "running";
      job.attempts += 1;
      job.updatedAt = nowIso();
      await this.put(job);
      try {
        const outcome = await runner(job);
        job.status = "done";
        job.result = outcome.result;
        if (outcome.reasoning) job.reasoning = outcome.reasoning;
        if (outcome.steps !== undefined) job.steps = outcome.steps;
        if (outcome.tools) job.tools = outcome.tools;
        if (outcome.usage) job.usage = outcome.usage;
        if (outcome.role) job.role = outcome.role;
        if (outcome.qa) job.qa = outcome.qa;
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        const maxAttempts = this.opts.maxAttempts ?? 1;
        if (job.attempts < maxAttempts) {
          job.status = "pending";
          const p = await this.readList(PENDING_KEY);
          p.push(job.id);
          await this.writeList(PENDING_KEY, p);
        } else {
          job.status = "error";
        }
      }
      job.updatedAt = nowIso();
      await this.put(job);
      done.push(job);
    }
    return done;
  }

  // --- internals ---

  private async put(job: Job): Promise<void> {
    const opts = this.opts.ttlSeconds ? { expirationTtl: this.opts.ttlSeconds } : undefined;
    await this.kv.put(this.jobKey(job.id), JSON.stringify(job), opts);
  }

  private async trackRecent(id: string): Promise<void> {
    const recent = await this.readList(RECENT_KEY);
    recent.push(id);
    const limit = this.opts.recentLimit ?? 100;
    await this.writeList(RECENT_KEY, recent.slice(-limit));
  }

  private async readList(key: string): Promise<string[]> {
    const raw = await this.kv.get(key);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  private async writeList(key: string, ids: string[]): Promise<void> {
    await this.kv.put(key, JSON.stringify(ids));
  }
}
