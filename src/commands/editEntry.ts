import fs from "node:fs/promises";
import path from "node:path";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, recordSpend } from "../cache/sync.js";
import { mapTimeEntry } from "../domain/mappers.js";
import type { TimeEntry } from "../domain/models.js";
import type { Config } from "../config/config.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import { parseTimeToday } from "./add.js";

export interface EditOptions {
  description?: string;
  projectName?: string;
  tags?: string[];
  start?: string;
  end?: string;
}

export async function runEditEntry(
  ctx: SyncContext,
  config: Config,
  entryId: number,
  opts: EditOptions
): Promise<TimeEntry> {
  if (
    opts.description === undefined &&
    opts.projectName === undefined &&
    opts.tags === undefined &&
    opts.start === undefined &&
    opts.end === undefined
  ) {
    throw new Error("Nothing to edit: pass at least one of description/project/start/end/tags.");
  }

  let projectId: number | undefined;
  if (opts.projectName) {
    // Same tradeoff as start/add: resolving against slightly stale cached
    // project data is acceptable on this mutation path.
    const { data: projects } = await getProjects(ctx);
    const match = projects.find((p) => p.name.toLowerCase() === opts.projectName!.toLowerCase());
    if (!match) throw new Error(`Unknown project: ${opts.projectName}`);
    projectId = match.id;
  }

  // start and end can each be given independently — e.g. nudging just the
  // start time of a still-running entry (which has no end yet). Only when
  // both are given do we cross-check ordering.
  const now = ctx.now();
  const start = opts.start ? parseTimeToday(opts.start, now).toISOString() : undefined;
  const stop = opts.end ? parseTimeToday(opts.end, now).toISOString() : undefined;
  if (start && stop && new Date(stop) <= new Date(start)) {
    throw new Error(`End time (${opts.end}) must be after start time (${opts.start}).`);
  }

  const raw = await ctx.client.updateTimeEntry(config.workspaceId, entryId, {
    description: opts.description,
    project_id: projectId,
    tags: opts.tags,
    start,
    stop,
  });
  // Mutations are never throttled by the budget, but they DO consume a real
  // Toggl request and must be counted, or the rolling-hour ledger undercounts.
  await recordSpend(ctx);
  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });

  const entry = mapTimeEntry(raw);
  // If this was the running timer, timer.json needs to reflect the change
  // immediately — waiting for the next refresh's reconciliation would leave
  // the dashboard showing the pre-edit start (and a wrong elapsed time) for
  // up to REFRESH_INTERVAL_MS.
  const localTimer = await readTimer(ctx.cacheDir);
  if (localTimer?.entryId === entryId && entry.durationSeconds === null) {
    await writeTimer(ctx.cacheDir, {
      entryId: entry.id,
      description: entry.description,
      projectId: entry.projectId,
      workspaceId: entry.workspaceId,
      startedAt: entry.start,
    });
  }

  return entry;
}
