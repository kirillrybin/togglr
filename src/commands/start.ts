import type { SyncContext } from "../cache/sync.js";
import { getProjects } from "../cache/sync.js";
import { readTimer, writeTimer } from "../cache/timerState.js";
import type { Config } from "../config/config.js";
import type { Timer } from "../domain/models.js";

export interface StartOptions {
  description: string;
  projectName?: string;
}

export async function createTimer(
  ctx: SyncContext,
  config: Config,
  description: string,
  projectId: number | null | undefined
): Promise<Timer> {
  const existing = await readTimer(ctx.cacheDir);
  if (existing) {
    throw new Error(`A timer is already running: "${existing.description}". Stop it first.`);
  }
  const raw = await ctx.client.createTimeEntry(config.workspaceId, {
    description,
    project_id: projectId ?? undefined,
  });
  const timer: Timer = {
    entryId: raw.id,
    description: raw.description,
    projectId: raw.project_id,
    workspaceId: raw.workspace_id,
    startedAt: raw.start,
  };
  await writeTimer(ctx.cacheDir, timer);
  return timer;
}

export async function runStart(ctx: SyncContext, config: Config, opts: StartOptions): Promise<Timer> {
  let projectId: number | undefined;
  if (opts.projectName) {
    const projects = await getProjects(ctx);
    const match = projects.find((p) => p.name.toLowerCase() === opts.projectName!.toLowerCase());
    if (!match) throw new Error(`Unknown project: ${opts.projectName}`);
    projectId = match.id;
  }
  return createTimer(ctx, config, opts.description, projectId);
}
