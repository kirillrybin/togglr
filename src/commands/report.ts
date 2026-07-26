import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries } from "../cache/sync.js";
import { aggregateReport, type ProjectSummary } from "../domain/report.js";

export type ReportRange = "today" | "week";

export function resolveRange(range: ReportRange, now: Date): { from: Date; to: Date } {
  const to = now;
  const from = new Date(now);
  if (range === "today") {
    from.setHours(0, 0, 0, 0);
  } else {
    const day = from.getDay();
    const diffToMonday = (day + 6) % 7;
    from.setDate(from.getDate() - diffToMonday);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

export async function runReport(ctx: SyncContext, range: ReportRange): Promise<ProjectSummary[]> {
  const [entries, projects] = await Promise.all([getTimeEntries(ctx), getProjects(ctx)]);
  const { from, to } = resolveRange(range, ctx.now());
  return aggregateReport(entries, projects, from, to, ctx.now());
}
