import type { Project, TimeEntry } from "./models.js";

export interface ProjectSummary {
  projectId: number | null;
  projectName: string;
  totalSeconds: number;
}

export function aggregateReport(
  entries: TimeEntry[],
  projects: Project[],
  from: Date,
  to: Date,
  now: Date = new Date()
): ProjectSummary[] {
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const totals = new Map<number | null, number>();

  for (const entryItem of entries) {
    const start = new Date(entryItem.start);
    if (start < from || start > to) continue;
    const duration = entryItem.durationSeconds ?? (now.getTime() - start.getTime()) / 1000;
    totals.set(entryItem.projectId, (totals.get(entryItem.projectId) ?? 0) + duration);
  }

  return [...totals.entries()]
    .map(([projectId, totalSeconds]) => ({
      projectId,
      projectName: projectId !== null ? nameById.get(projectId) ?? "Unknown" : "No project",
      totalSeconds,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}
