import fs from "node:fs/promises";
import path from "node:path";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, recordSpend } from "../cache/sync.js";
import { mapTimeEntry } from "../domain/mappers.js";
import type { TimeEntry } from "../domain/models.js";
import type { Config } from "../config/config.js";
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
  if (Boolean(opts.start) !== Boolean(opts.end)) {
    throw new Error("Both --start and --end must be given together to change the time.");
  }
  if (
    opts.description === undefined &&
    opts.projectName === undefined &&
    opts.tags === undefined &&
    opts.start === undefined
  ) {
    throw new Error("Nothing to edit: pass at least one of description/project/start+end/tags.");
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

  let start: string | undefined;
  let stop: string | undefined;
  if (opts.start && opts.end) {
    const now = ctx.now();
    const startDate = parseTimeToday(opts.start, now);
    const endDate = parseTimeToday(opts.end, now);
    if (endDate <= startDate) {
      throw new Error(`End time (${opts.end}) must be after start time (${opts.start}).`);
    }
    start = startDate.toISOString();
    stop = endDate.toISOString();
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

  return mapTimeEntry(raw);
}
