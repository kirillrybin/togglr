import type { SyncContext } from "../cache/sync.js";
import { getProjects, getTimeEntries, type DegradedReason } from "../cache/sync.js";
import { aggregateReport, type ProjectSummary } from "../domain/report.js";
import { formatDuration } from "./status.js";

export type ReportRange = "today" | "week";

export interface CustomRange {
  from: Date;
  to: Date;
}

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

// Validates real calendar dates (rejects e.g. "2026-02-30") by round-tripping
// through Date's field setters rather than trusting the regex alone.
export function parseReportDate(label: string, value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid ${label} date "${value}", expected YYYY-MM-DD.`);
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid ${label} date "${value}".`);
  }
  return date;
}

export async function runReport(
  ctx: SyncContext,
  range: ReportRange | CustomRange
): Promise<{ data: ProjectSummary[]; degraded: DegradedReason | null }> {
  const [entriesResult, projectsResult] = await Promise.all([getTimeEntries(ctx), getProjects(ctx)]);
  const { from, to } = typeof range === "string" ? resolveRange(range, ctx.now()) : range;
  const data = aggregateReport(entriesResult.data, projectsResult.data, from, to, ctx.now());
  const degraded = entriesResult.degraded ?? projectsResult.degraded;
  return { data, degraded };
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatReportCsv(summaries: ProjectSummary[]): string {
  const header = "project,duration,seconds";
  const rows = summaries.map((s) => {
    const seconds = Math.round(s.totalSeconds);
    return `${csvEscape(s.projectName)},${formatDuration(seconds)},${seconds}`;
  });
  return [header, ...rows].join("\n");
}
