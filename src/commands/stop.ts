import fs from "node:fs/promises";
import path from "node:path";
import { TogglApiError } from "../api/client.js";
import type { SyncContext } from "../cache/sync.js";
import { recordSpend } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import { mapTimeEntry } from "../domain/mappers.js";
import type { TimeEntry } from "../domain/models.js";
import type { Config } from "../config/config.js";

export async function runStop(ctx: SyncContext, config: Config): Promise<TimeEntry> {
  const timer = await readTimer(ctx.cacheDir);
  if (!timer) throw new Error("No timer is currently running.");

  let raw;
  try {
    raw = await ctx.client.stopTimeEntry(config.workspaceId, timer.entryId);
  } catch (err) {
    if (err instanceof TogglApiError && err.status === 404) {
      // The locally-tracked entry no longer exists on Toggl (e.g. deleted via
      // another client). Local state has diverged from reality and would
      // otherwise block every future start/stop forever — clear it here.
      await writeTimer(ctx.cacheDir, null);
      await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });
      throw new Error(
        `"${timer.description}" no longer exists on Toggl (it may have been deleted elsewhere). Local timer state has been cleared.`
      );
    }
    throw err;
  }
  // Mutations are never throttled by the budget, but they DO consume a real
  // Toggl request and must be counted, or the rolling-hour ledger undercounts.
  await recordSpend(ctx);
  const entry = mapTimeEntry(raw);

  await writeTimer(ctx.cacheDir, null);
  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });

  return entry;
}
