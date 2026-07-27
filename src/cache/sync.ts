import path from "node:path";
import type { TogglApiClient } from "../api/client.js";
import { mapProjects, mapTimeEntries } from "../domain/mappers.js";
import type { Project, TimeEntry } from "../domain/models.js";
import { reconcileTimer } from "../domain/reconcileTimer.js";
import { readCacheEntry, writeCacheEntry, isStale, readJson, writeJson } from "./store.js";
import { canSpend, recordRequest, type RateLimiterState } from "./rateLimiter.js";
import { readTimer, writeTimer } from "./timerState.js";

export const DEFAULT_BUDGET_PER_HOUR = 25;

export interface SyncContext {
  client: TogglApiClient;
  cacheDir: string;
  ttlSeconds: { projects: number; timeEntries: number };
  budgetPerHour: number;
  now: () => Date;
}

/**
 * Why a read could not be served fresh:
 *  - "throttled": the rolling-hour budget is exhausted, we deliberately did not call.
 *  - "offline": we tried to call and the request failed (network down, API error).
 * Either way the caller still gets whatever cached data exists (possibly empty).
 */
export type DegradedReason = "throttled" | "offline";

export interface CacheReadResult<T> {
  data: T;
  degraded: DegradedReason | null;
}

function projectsFile(ctx: SyncContext): string {
  return path.join(ctx.cacheDir, "projects.json");
}

function timeEntriesFile(ctx: SyncContext): string {
  return path.join(ctx.cacheDir, "time_entries.json");
}

function rateLimitFile(ctx: SyncContext): string {
  return path.join(ctx.cacheDir, "rate_limit.json");
}

async function recordSpendAt(ctx: SyncContext, now: Date): Promise<void> {
  const rlState = (await readJson<RateLimiterState>(rateLimitFile(ctx))) ?? { timestamps: [] };
  await writeJson(rateLimitFile(ctx), recordRequest(rlState, now));
}

/**
 * Exported so mutating commands (start/stop) can record their own API spend —
 * mutations are never THROTTLED by the budget, but they must still be COUNTED,
 * or the rolling-hour ledger silently undercounts real traffic and we can blow
 * through Toggl's actual 30/hour ceiling while our own counter looks healthy.
 */
export async function recordSpend(ctx: SyncContext): Promise<void> {
  await recordSpendAt(ctx, ctx.now());
}

type RefreshOutcome =
  | { ok: true; projects: Project[]; timeEntries: TimeEntry[] }
  | { ok: false; reason: DegradedReason };

async function performRefresh(ctx: SyncContext, force: boolean): Promise<RefreshOutcome> {
  const now = ctx.now();
  if (!force) {
    const rlState = (await readJson<RateLimiterState>(rateLimitFile(ctx))) ?? { timestamps: [] };
    if (!canSpend(rlState, now, ctx.budgetPerHour)) {
      return { ok: false, reason: "throttled" };
    }
  }
  // Record the spend BEFORE the call: a failed/errored request still consumed
  // real budget on Toggl's side and must still count against ours.
  await recordSpendAt(ctx, now);

  let me;
  try {
    me = await ctx.client.getMe(true);
  } catch {
    return { ok: false, reason: "offline" };
  }

  const projects = mapProjects(me.projects ?? []);
  const timeEntries = mapTimeEntries(me.time_entries ?? []);
  await writeCacheEntry(projectsFile(ctx), projects, now);
  await writeCacheEntry(timeEntriesFile(ctx), timeEntries, now);

  // We already have fresh truth from Toggl at zero extra API cost — use it to
  // self-heal timer.json if it silently diverged (started/stopped/deleted, or
  // had one of its fields — e.g. start time — changed via another client)
  // instead of waiting for a mutation to fail against it. Written
  // unconditionally: comparing only entryId would miss a same-entry field
  // change (like an edited start time) and leave it stuck forever.
  const reconciled = reconcileTimer(await readTimer(ctx.cacheDir), timeEntries);
  await writeTimer(ctx.cacheDir, reconciled);

  return { ok: true, projects, timeEntries };
}

// Single-flight guard: concurrent callers sharing the same cacheDir (e.g. a
// Promise.all([getTimeEntries(ctx), getProjects(ctx)]) call from report.ts or
// the TUI's loadState) must await one in-flight refresh instead of each
// triggering their own /me call and their own (mutually-clobbering) rate
// limiter write. Keyed by cacheDir since that uniquely identifies "this app's
// cache instance" for a given user.
const inFlightRefreshes = new Map<string, Promise<RefreshOutcome>>();

export function refreshAll(
  ctx: SyncContext,
  opts: { force?: boolean } = {}
): Promise<RefreshOutcome> {
  const key = ctx.cacheDir;
  const existing = inFlightRefreshes.get(key);
  if (existing) return existing;

  const promise = performRefresh(ctx, opts.force ?? false).finally(() => {
    inFlightRefreshes.delete(key);
  });
  inFlightRefreshes.set(key, promise);
  return promise;
}

export async function getProjects(
  ctx: SyncContext,
  opts: { force?: boolean } = {}
): Promise<CacheReadResult<Project[]>> {
  const file = projectsFile(ctx);
  const now = ctx.now();
  const cached = await readCacheEntry<Project[]>(file);
  if (!opts.force && cached && !isStale(cached, ctx.ttlSeconds.projects, now)) {
    return { data: cached.data, degraded: null };
  }
  const outcome = await refreshAll(ctx, opts);
  if (outcome.ok) return { data: outcome.projects, degraded: null };
  return { data: cached?.data ?? [], degraded: outcome.reason };
}

export async function getTimeEntries(
  ctx: SyncContext,
  opts: { force?: boolean } = {}
): Promise<CacheReadResult<TimeEntry[]>> {
  const file = timeEntriesFile(ctx);
  const now = ctx.now();
  const cached = await readCacheEntry<TimeEntry[]>(file);
  if (!opts.force && cached && !isStale(cached, ctx.ttlSeconds.timeEntries, now)) {
    return { data: cached.data, degraded: null };
  }
  const outcome = await refreshAll(ctx, opts);
  if (outcome.ok) return { data: outcome.timeEntries, degraded: null };
  return { data: cached?.data ?? [], degraded: outcome.reason };
}
