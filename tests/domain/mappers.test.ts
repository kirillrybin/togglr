import { describe, expect, it } from "vitest";
import { mapProject, mapTimeEntry } from "../../src/domain/mappers.js";

describe("mapProject", () => {
  it("converts snake_case fields to camelCase", () => {
    const result = mapProject({ id: 1, name: "Website", color: "#fff", workspace_id: 9 });
    expect(result).toEqual({ id: 1, name: "Website", color: "#fff", workspaceId: 9 });
  });
});

describe("mapTimeEntry", () => {
  it("sets durationSeconds to the raw duration when stopped", () => {
    const result = mapTimeEntry({
      id: 1, description: "Coding", project_id: 5, workspace_id: 9,
      start: "2026-07-26T10:00:00Z", stop: "2026-07-26T10:30:00Z", duration: 1800, tags: ["a"],
    });
    expect(result.durationSeconds).toBe(1800);
    expect(result.tags).toEqual(["a"]);
  });

  it("sets durationSeconds to null when still running (stop is null)", () => {
    const result = mapTimeEntry({
      id: 1, description: "Coding", project_id: null, workspace_id: 9,
      start: "2026-07-26T10:00:00Z", stop: null, duration: -1721981000, tags: null,
    });
    expect(result.durationSeconds).toBeNull();
    expect(result.tags).toEqual([]);
  });
});
