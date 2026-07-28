import fs from "node:fs/promises";
import path from "node:path";
import type { SyncContext } from "../cache/sync.js";
import { recordSpend } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import { mapTimeEntry } from "../domain/mappers.js";
import type { TimeEntry } from "../domain/models.js";
import type { Config } from "../config/config.js";

// Everything runDeleteEntry's caller needs to have captured *before* calling
// it, since the entry is gone from Toggl (and the cache) afterwards.
export interface DeletedEntrySnapshot {
  description: string;
  projectId: number | null;
  start: string;
  stop: string | null;
  tags: string[];
}

// Toggl's delete is a real hard delete — there's no server-side undo, so this
// recreates the entry instead. It gets a new id, but a still-running entry
// keeps its original elapsed time: the create endpoint accepts a backdated
// `start` alongside duration -1 (confirmed against the real API), so it
// isn't restarted at "now".
export async function runUndoDelete(
  ctx: SyncContext,
  config: Config,
  snapshot: DeletedEntrySnapshot
): Promise<TimeEntry> {
  let raw;
  if (snapshot.stop === null) {
    const existing = await readTimer(ctx.cacheDir);
    if (existing) {
      throw new Error(
        `Can't restore "${snapshot.description}" as a running timer — "${existing.description}" is already running.`
      );
    }
    raw = await ctx.client.createTimeEntry(config.workspaceId, {
      description: snapshot.description,
      project_id: snapshot.projectId ?? undefined,
      tags: snapshot.tags,
      start: snapshot.start,
    });
  } else {
    raw = await ctx.client.createCompletedTimeEntry(config.workspaceId, {
      description: snapshot.description,
      project_id: snapshot.projectId ?? undefined,
      tags: snapshot.tags,
      start: snapshot.start,
      stop: snapshot.stop,
    });
  }
  // Mutations are never throttled by the budget, but they DO consume a real
  // Toggl request and must be counted, or the rolling-hour ledger undercounts.
  await recordSpend(ctx);
  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });

  const entry = mapTimeEntry(raw);
  if (snapshot.stop === null) {
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
