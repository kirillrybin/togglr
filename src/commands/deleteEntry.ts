import fs from "node:fs/promises";
import path from "node:path";
import { TogglApiError } from "../api/client.js";
import type { SyncContext } from "../cache/sync.js";
import { recordSpend } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import type { Config } from "../config/config.js";

export async function runDeleteEntry(ctx: SyncContext, config: Config, entryId: number): Promise<void> {
  try {
    await ctx.client.deleteTimeEntry(config.workspaceId, entryId);
    // Mutations are never throttled by the budget, but they DO consume a real
    // Toggl request and must be counted, or the rolling-hour ledger undercounts.
    await recordSpend(ctx);
  } catch (err) {
    if (!(err instanceof TogglApiError && err.status === 404)) throw err;
    // Already gone (e.g. deleted elsewhere) — the end state we wanted is
    // already true, so treat it as success rather than erroring.
  }

  await fs.rm(path.join(ctx.cacheDir, "time_entries.json"), { force: true });

  const timer = await readTimer(ctx.cacheDir);
  if (timer?.entryId === entryId) {
    await writeTimer(ctx.cacheDir, null);
  }
}
