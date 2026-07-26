export interface Project {
  id: number;
  name: string;
  color: string;
  workspaceId: number;
}

export interface TimeEntry {
  id: number;
  description: string;
  projectId: number | null;
  workspaceId: number;
  start: string;
  stop: string | null;
  durationSeconds: number | null;
  tags: string[];
}

export interface Timer {
  entryId: number;
  description: string;
  projectId: number | null;
  workspaceId: number;
  startedAt: string;
}
