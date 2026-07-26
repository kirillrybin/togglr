import { describe, expect, it } from "vitest";
import { aggregateReport } from "../../src/domain/report.js";
import type { TimeEntry, Project } from "../../src/domain/models.js";

const projects: Project[] = [{ id: 1, name: "Website", color: "#fff", workspaceId: 9 }];

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 1, description: "Coding", projectId: 1, workspaceId: 9,
    start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z",
    durationSeconds: 1800, tags: [], ...overrides,
  };
}

describe("aggregateReport", () => {
  it("sums durations per project within the date range", () => {
    const entries = [entry({ durationSeconds: 1800 }), entry({ id: 2, durationSeconds: 900 })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const result = aggregateReport(entries, projects, from, to);
    expect(result).toEqual([{ projectId: 1, projectName: "Website", totalSeconds: 2700 }]);
  });

  it("excludes entries outside the date range", () => {
    const entries = [entry({ start: "2026-07-20T10:00:00Z" })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    expect(aggregateReport(entries, projects, from, to)).toEqual([]);
  });

  it("labels entries with no project as 'No project'", () => {
    const entries = [entry({ projectId: null })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const result = aggregateReport(entries, projects, from, to);
    expect(result[0]).toMatchObject({ projectId: null, projectName: "No project" });
  });

  it("computes live duration for a still-running entry using `now`", () => {
    const entries = [entry({ stop: null, durationSeconds: null, start: "2026-07-26T10:00:00Z" })];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const now = new Date("2026-07-26T10:05:00Z");
    const result = aggregateReport(entries, projects, from, to, now);
    expect(result[0].totalSeconds).toBe(300);
  });

  it("sorts results by totalSeconds descending", () => {
    const entries = [
      entry({ id: 1, projectId: 1, durationSeconds: 100 }),
      entry({ id: 2, projectId: null, durationSeconds: 500 }),
    ];
    const from = new Date("2026-07-26T00:00:00Z");
    const to = new Date("2026-07-26T23:59:59Z");
    const result = aggregateReport(entries, projects, from, to);
    expect(result[0].projectId).toBeNull();
    expect(result[1].projectId).toBe(1);
  });
});
