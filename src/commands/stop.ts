import fs from "node:fs/promises";
import path from "node:path";
import type { SyncContext } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import { mapTimeEntry } from "../domain/mappers.js";
import type { TimeEntry } from "../domain/models.js";
import type { Config } from "../config/config.js";

export async function runStop(ctx: SyncContext, config: Config): Promise<TimeEntry> {
  const timer = await readTimer(ctx.cacheDir);
  if (!timer) throw new Error("No timer is currently running.");

  const raw = await ctx.client.stopTimeEntry(config.workspaceId, timer.entryId);
  const entry = mapTimeEntry(raw);

  await writeTimer(ctx.cacheDir, null);
  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });

  return entry;
}
