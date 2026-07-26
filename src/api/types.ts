export interface TogglProjectRaw {
  id: number;
  name: string;
  color: string;
  workspace_id: number;
}

export interface TogglTimeEntryRaw {
  id: number;
  description: string;
  project_id: number | null;
  workspace_id: number;
  start: string;
  stop: string | null;
  duration: number;
  tags: string[] | null;
}

export interface TogglMeResponse {
  id: number;
  default_workspace_id: number;
  projects?: TogglProjectRaw[];
  time_entries?: TogglTimeEntryRaw[];
}
