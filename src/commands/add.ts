import fs from "node:fs/promises";
import path from "node:path";
import type { SyncContext } from "../cache/sync.js";
import { getProjects, recordSpend } from "../cache/sync.js";
import { mapTimeEntry } from "../domain/mappers.js";
import type { TimeEntry } from "../domain/models.js";
import type { Config } from "../config/config.js";

export interface AddOptions {
  description: string;
  projectName?: string;
  tags?: string[];
  start: string;
  end: string;
}

export function parseTimeToday(hhmm: string, referenceDate: Date): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Invalid time "${hhmm}", expected HH:MM.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time "${hhmm}", expected HH:MM.`);
  const result = new Date(referenceDate);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function formatTimeHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export async function runAdd(ctx: SyncContext, config: Config, opts: AddOptions): Promise<TimeEntry> {
  const now = ctx.now();
  const start = parseTimeToday(opts.start, now);
  const end = parseTimeToday(opts.end, now);
  if (end <= start) {
    throw new Error(`End time (${opts.end}) must be after start time (${opts.start}).`);
  }

  let projectId: number | undefined;
  if (opts.projectName) {
    // Same tradeoff as start/continue: resolving against slightly stale
    // cached project data is acceptable on this mutation path.
    const { data: projects } = await getProjects(ctx);
    const match = projects.find((p) => p.name.toLowerCase() === opts.projectName!.toLowerCase());
    if (!match) throw new Error(`Unknown project: ${opts.projectName}`);
    projectId = match.id;
  }

  const raw = await ctx.client.createCompletedTimeEntry(config.workspaceId, {
    description: opts.description,
    project_id: projectId,
    tags: opts.tags,
    start: start.toISOString(),
    stop: end.toISOString(),
  });
  // Mutations are never throttled by the budget, but they DO consume a real
  // Toggl request and must be counted, or the rolling-hour ledger undercounts.
  await recordSpend(ctx);
  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });

  return mapTimeEntry(raw);
}
