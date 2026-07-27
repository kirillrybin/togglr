import fs from "node:fs/promises";
import path from "node:path";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, recordSpend } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import type { Config } from "../config/config.js";
import type { Timer } from "../domain/models.js";

export interface StartOptions {
  description: string;
  projectName?: string;
  tags?: string[];
}

export async function createTimer(
  ctx: SyncContext,
  config: Config,
  description: string,
  projectId: number | null | undefined,
  tags?: string[]
): Promise<Timer> {
  const existing = await readTimer(ctx.cacheDir);
  if (existing) {
    throw new Error(`A timer is already running: "${existing.description}". Stop it first.`);
  }
  const raw = await ctx.client.createTimeEntry(config.workspaceId, {
    description,
    project_id: projectId ?? undefined,
    tags,
  });
  // Mutations are never throttled by the budget, but they DO consume a real
  // Toggl request and must be counted, or the rolling-hour ledger undercounts.
  await recordSpend(ctx);
  const timer: Timer = {
    entryId: raw.id,
    description: raw.description,
    projectId: raw.project_id,
    workspaceId: raw.workspace_id,
    startedAt: raw.start,
  };
  await writeTimer(ctx.cacheDir, timer);
  // Otherwise the recent-entries list (and anything else reading
  // time_entries.json) keeps serving the pre-start snapshot until the 5-minute
  // TTL happens to expire — the new entry just silently doesn't show up yet.
  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });
  return timer;
}

export async function runStart(ctx: SyncContext, config: Config, opts: StartOptions): Promise<Timer> {
  let projectId: number | undefined;
  if (opts.projectName) {
    // `degraded` is deliberately ignored: on a mutation path, resolving the
    // project name against slightly stale project data is an acceptable tradeoff.
    const { data: projects } = await getProjects(ctx);
    const match = projects.find((p) => p.name.toLowerCase() === opts.projectName!.toLowerCase());
    if (!match) throw new Error(`Unknown project: ${opts.projectName}`);
    projectId = match.id;
  }
  return createTimer(ctx, config, opts.description, projectId, opts.tags);
}
