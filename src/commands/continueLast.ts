import type { SyncContext } from "../cache/sync.js";
import { getTimeEntries } from "../cache/sync.js";
import { createTimer } from "./start.js";
import type { Config } from "../config/config.js";
import type { Timer } from "../domain/models.js";

export async function runContinue(ctx: SyncContext, config: Config): Promise<Timer> {
  const { data: entries } = await getTimeEntries(ctx);
  const last = [...entries].sort(
    (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()
  )[0];
  if (!last) throw new Error("No previous time entry to continue.");
  return createTimer(ctx, config, last.description, last.projectId);
}
