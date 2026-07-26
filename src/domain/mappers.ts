import type { TogglProjectRaw, TogglTimeEntryRaw } from "../api/types.js";
import type { Project, TimeEntry } from "./models.js";

export function mapProject(raw: TogglProjectRaw): Project {
  return { id: raw.id, name: raw.name, color: raw.color, workspaceId: raw.workspace_id };
}

export function mapProjects(raws: TogglProjectRaw[]): Project[] {
  return raws.map(mapProject);
}

export function mapTimeEntry(raw: TogglTimeEntryRaw): TimeEntry {
  return {
    id: raw.id,
    description: raw.description,
    projectId: raw.project_id,
    workspaceId: raw.workspace_id,
    start: raw.start,
    stop: raw.stop,
    durationSeconds: raw.stop === null ? null : raw.duration,
    tags: raw.tags ?? [],
  };
}

export function mapTimeEntries(raws: TogglTimeEntryRaw[]): TimeEntry[] {
  return raws.map(mapTimeEntry);
}
