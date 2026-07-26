import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries, type DegradedReason } from "../cache/sync.js";
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

export async function runReport(
  ctx: SyncContext,
  range: ReportRange
): Promise<{ data: ProjectSummary[]; degraded: DegradedReason | null }> {
  const [entriesResult, projectsResult] = await Promise.all([getTimeEntries(ctx), getProjects(ctx)]);
  const { from, to } = resolveRange(range, ctx.now());
  const data = aggregateReport(entriesResult.data, projectsResult.data, from, to, ctx.now());
  const degraded = entriesResult.degraded ?? projectsResult.degraded;
  return { data, degraded };
}
