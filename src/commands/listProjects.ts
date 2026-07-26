import type { SyncContext } from "../cache/sync.js";
import { getProjects } from "../cache/sync.js";
import type { Project } from "../domain/models.js";

export async function runListProjects(ctx: SyncContext): Promise<Project[]> {
  return getProjects(ctx);
}
