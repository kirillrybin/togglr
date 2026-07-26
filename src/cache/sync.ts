import path from "node:path";
import type { TogglApiClient } from "../api/client.js";
import { mapProjects, mapTimeEntries } from "../domain/mappers.js";
import type { Project, TimeEntry } from "../domain/models.js";
import { readCacheEntry, writeCacheEntry, isStale, readJson, writeJson } from "./store.js";
import { canSpend, recordRequest, type RateLimiterState } from "./rateLimiter.js";

export const DEFAULT_BUDGET_PER_HOUR = 25;

export interface SyncContext {
  client: TogglApiClient;
  cacheDir: string;
  ttlSeconds: { projects: number; timeEntries: number };
  budgetPerHour: number;
  now: () => Date;
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

type RefreshResult = { projects: Project[]; timeEntries: TimeEntry[] } | null;

// Single-flight guard: concurrent callers sharing the same cacheDir (e.g. a
// Promise.all([getTimeEntries(ctx), getProjects(ctx)]) call from report.ts or
// the TUI's loadState) must await one in-flight refresh instead of each
// triggering their own /me call and their own (mutually-clobbering) rate
// limiter write. Keyed by cacheDir since that uniquely identifies "this app's
// cache instance" for a given user.
const inFlightRefreshes = new Map<string, Promise<RefreshResult>>();

async function performRefresh(ctx: SyncContext): Promise<RefreshResult> {
  const now = ctx.now();
  const rlState = (await readJson<RateLimiterState>(rateLimitFile(ctx))) ?? { timestamps: [] };
  if (!canSpend(rlState, now, ctx.budgetPerHour)) return null;

  const me = await ctx.client.getMe(true);
  await writeJson(rateLimitFile(ctx), recordRequest(rlState, now));

  const projects = mapProjects(me.projects ?? []);
  const timeEntries = mapTimeEntries(me.time_entries ?? []);
  await writeCacheEntry(projectsFile(ctx), projects, now);
  await writeCacheEntry(timeEntriesFile(ctx), timeEntries, now);
  return { projects, timeEntries };
}

export function refreshAll(ctx: SyncContext): Promise<RefreshResult> {
  const key = ctx.cacheDir;
  const existing = inFlightRefreshes.get(key);
  if (existing) return existing;

  const promise = performRefresh(ctx).finally(() => {
    inFlightRefreshes.delete(key);
  });
  inFlightRefreshes.set(key, promise);
  return promise;
}

export async function getProjects(ctx: SyncContext): Promise<Project[]> {
  const file = projectsFile(ctx);
  const now = ctx.now();
  const cached = await readCacheEntry<Project[]>(file);
  if (cached && !isStale(cached, ctx.ttlSeconds.projects, now)) return cached.data;
  const refreshed = await refreshAll(ctx);
  return refreshed?.projects ?? cached?.data ?? [];
}

export async function getTimeEntries(ctx: SyncContext): Promise<TimeEntry[]> {
  const file = timeEntriesFile(ctx);
  const now = ctx.now();
  const cached = await readCacheEntry<TimeEntry[]>(file);
  if (cached && !isStale(cached, ctx.ttlSeconds.timeEntries, now)) return cached.data;
  const refreshed = await refreshAll(ctx);
  return refreshed?.timeEntries ?? cached?.data ?? [];
}
