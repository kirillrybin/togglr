import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../src/tui/App.js";
import { writeCacheEntry } from "../../src/cache/store.js";
import type { SyncContext } from "../../src/cache/sync.js";
import type { Config } from "../../src/config/config.js";

// Drives the real App component through ink-testing-library's stdin, so
// these exercise the actual key-handling/mode-transition logic (not just the
// presentational Dashboard) — only the Toggl API client is mocked. Written
// as a plausible-but-lighter counterpart to the extensive manual pty testing
// this feature set was originally verified with.

const NOW = new Date("2026-07-28T12:00:00Z");
// Cache entries are written as of "now", so both TTLs are fresh and the
// initial mount serves them as-is without an unwanted getMe refetch that
// would otherwise clobber the seeded data with whatever getMe is mocked to
// return (empty, by default in makeCtx).
const SYNCED_AT = NOW;

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1B[B";

function makeCtx(dir: string, client: Partial<SyncContext["client"]> = {}): SyncContext {
  return {
    client: {
      getMe: vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 9, projects: [], time_entries: [] }),
      createTimeEntry: vi.fn(),
      createCompletedTimeEntry: vi.fn(),
      updateTimeEntry: vi.fn(),
      stopTimeEntry: vi.fn(),
      deleteTimeEntry: vi.fn(),
      ...client,
    } as any,
    cacheDir: dir,
    ttlSeconds: { projects: 21600, timeEntries: 300 },
    budgetPerHour: 25,
    now: () => NOW,
  };
}

const config: Config = {
  apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 }, showProjectColors: false,
};

// Every useInput hook (App's own, and ink-text-input's internal one) tears
// down and re-registers its listener on every render — including on plain
// keystrokes that only update local text state, not just mode changes.
// Firing the next keystroke before that re-registration lands makes it land
// on a stale closure (e.g. Enter submitting the text-before-last keystroke).
// A settle pause after every write sidesteps that race far more reliably
// than trying to predict exactly which keystrokes need it.
async function type(instance: ReturnType<typeof render>, data: string): Promise<void> {
  instance.stdin.write(data);
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function waitForFrame(
  instance: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
  timeoutMs = 2000
): Promise<string> {
  const start = Date.now();
  let matchedAt: number | null = null;
  for (;;) {
    const frame = instance.lastFrame() ?? "";
    if (predicate(frame)) {
      // Confirm the match is stable rather than returning the instant it's
      // first seen — the predicate can already be true on the very first
      // synchronous render (e.g. static footer text), before useInput's
      // effects have actually registered their listeners.
      matchedAt ??= Date.now();
      if (Date.now() - matchedAt > 30) return frame;
    } else {
      matchedAt = null;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitForFrame timed out. Last frame:\n${frame}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForText(instance: ReturnType<typeof render>, text: string, timeoutMs?: number): Promise<string> {
  return waitForFrame(instance, (frame) => frame.includes(text), timeoutMs);
}

describe("App", () => {
  let dir: string;
  let instance: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-app-test-"));
  });

  afterEach(async () => {
    instance?.unmount();
    instance = null;
    // Cache writes triggered just before unmount (e.g. an in-flight refresh)
    // can still land a moment later — give them a beat before nuking the dir,
    // or writeJson's rename(2) can race an already-deleted directory.
    await new Promise((resolve) => setTimeout(resolve, 20));
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads and shows recent entries on mount", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Fix login bug", projectId: null, workspaceId: 9, start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z", durationSeconds: 1800, tags: [] },
    ], SYNCED_AT);
    const ctx = makeCtx(dir);

    instance = render(<App ctx={ctx} config={config} />);

    await waitForText(instance, "Fix login bug");
  });

  it("j/k move the highlight, confirmed by which entry a subsequent delete targets", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Second (most recent)", projectId: null, workspaceId: 9, start: "2026-07-28T10:00:00Z", stop: "2026-07-28T10:30:00Z", durationSeconds: 1800, tags: [] },
      { id: 2, description: "First (older)", projectId: null, workspaceId: 9, start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z", durationSeconds: 1800, tags: [] },
    ], SYNCED_AT);
    const ctx = makeCtx(dir);

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "First (older)"); // both entries loaded
    await type(instance, "j"); // move off the default top (most recent) entry
    await type(instance, "d");

    await waitForText(instance, 'Delete "First (older)"?');
  });

  it("new-timer wizard (description -> project -> tags) creates a timer with all three resolved", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [{ id: 5, name: "Website", color: "#fff", workspaceId: 9 }], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [], SYNCED_AT);
    const createTimeEntry = vi.fn().mockResolvedValue({
      id: 1, description: "New task", project_id: 5, workspace_id: 9, start: "2026-07-28T12:00:00Z", stop: null, duration: -1, tags: ["urgent"],
    });
    const ctx = makeCtx(dir, { createTimeEntry });

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "[q] quit"); // footer present once the dashboard has mounted
    await type(instance, "n");
    await waitForText(instance, "New timer");
    await type(instance, "New task");
    await waitForText(instance, "New timer: New task");
    await type(instance, ENTER);
    await waitForText(instance, "Project");
    await type(instance, "Web");
    await waitForText(instance, "Website"); // suggestion appears
    await type(instance, DOWN); // highlight the "Website" suggestion
    await type(instance, ENTER); // picks the highlighted suggestion, advances to tags
    await waitForText(instance, "Tags");
    await type(instance, "urgent");
    await waitForText(instance, "Tags (comma-separated, Tab to autocomplete, blank = none): urgent");
    await type(instance, ENTER);

    await vi.waitFor(() => expect(createTimeEntry).toHaveBeenCalled());
    expect(createTimeEntry).toHaveBeenCalledWith(9, {
      description: "New task", project_id: 5, tags: ["urgent"],
    });
  });

  it("edit wizard skips the end-time step for a running entry, going straight to project", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Running task", projectId: null, workspaceId: 9, start: "2026-07-28T11:00:00Z", stop: null, durationSeconds: null, tags: [] },
    ], SYNCED_AT);
    const ctx = makeCtx(dir);

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "Running task");
    await type(instance, "e");
    await waitForText(instance, "Edit description");
    await type(instance, ENTER);
    await waitForText(instance, "Edit start");
    await type(instance, ENTER);

    const frame = await waitForText(instance, "Edit project");
    expect(frame).not.toContain("Edit end");
  });

  it("edit wizard includes the end-time step for a completed entry", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Done task", projectId: null, workspaceId: 9, start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z", durationSeconds: 1800, tags: [] },
    ], SYNCED_AT);
    const ctx = makeCtx(dir);

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "Done task");
    await type(instance, "e");
    await waitForText(instance, "Edit description");
    await type(instance, ENTER);

    await waitForText(instance, "Edit start");
    await type(instance, ENTER);

    await waitForText(instance, "Edit end");
  });

  it("search (/) filters live while typing, then keeps the filter applied after Enter", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Alpha task", projectId: null, workspaceId: 9, start: "2026-07-28T10:00:00Z", stop: "2026-07-28T10:30:00Z", durationSeconds: 1800, tags: [] },
      { id: 2, description: "Beta task", projectId: null, workspaceId: 9, start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z", durationSeconds: 1800, tags: [] },
    ], SYNCED_AT);
    const ctx = makeCtx(dir);

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "Beta task"); // both loaded
    await type(instance, "/");
    await waitForText(instance, "Filter"); // the search prompt itself, label "Filter"
    await type(instance, "alpha");

    let frame = await waitForFrame(instance, (f) => !f.includes("Beta task"));
    expect(frame).toContain("Alpha task");

    await type(instance, ENTER);

    frame = await waitForFrame(instance, (f) => f.includes('Filter: "alpha"'));
    expect(frame).toContain("Alpha task");
    expect(frame).not.toContain("Beta task");
  });

  it("Escape cancels an in-progress search edit without touching the already-committed filter", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "Alpha task", projectId: null, workspaceId: 9, start: "2026-07-28T10:00:00Z", stop: "2026-07-28T10:30:00Z", durationSeconds: 1800, tags: [] },
      { id: 2, description: "Beta task", projectId: null, workspaceId: 9, start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z", durationSeconds: 1800, tags: [] },
    ], SYNCED_AT);
    const ctx = makeCtx(dir);

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "Beta task");
    await type(instance, "/");
    await waitForText(instance, "Filter");
    await type(instance, "alpha");
    await waitForFrame(instance, (f) => !f.includes("Beta task"));
    await type(instance, ENTER); // commit "alpha"
    await waitForFrame(instance, (f) => f.includes('Filter: "alpha"'));
    await type(instance, "/");
    await waitForText(instance, "Filter: alpha"); // re-opened, prefilled with the committed query
    await type(instance, "beta"); // in-progress edit, not yet submitted
    await waitForText(instance, "alphabeta");
    await type(instance, ESC); // cancel — should revert to the committed "alpha"

    const frame = await waitForFrame(instance, (f) => !f.includes("alphabeta"));
    expect(frame).toContain("Alpha task");
    expect(frame).not.toContain("Beta task");
  });

  it("delete asks for confirmation, then undo recreates the entry from its snapshot", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [
      { id: 1, description: "To delete", projectId: null, workspaceId: 9, start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z", durationSeconds: 1800, tags: ["urgent"] },
    ], SYNCED_AT);
    const deleteTimeEntry = vi.fn().mockResolvedValue(undefined);
    const createCompletedTimeEntry = vi.fn().mockResolvedValue({
      id: 2, description: "To delete", project_id: null, workspace_id: 9, start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z", duration: 1800, tags: ["urgent"],
    });
    const ctx = makeCtx(dir, { deleteTimeEntry, createCompletedTimeEntry });

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "To delete");
    await type(instance, "d");
    await waitForText(instance, 'Delete "To delete"?');
    await type(instance, "y");

    await vi.waitFor(() => expect(deleteTimeEntry).toHaveBeenCalled());
    expect(deleteTimeEntry).toHaveBeenCalledWith(9, 1);
    await waitForText(instance, "press 'u' to undo");

    await type(instance, "u");

    await vi.waitFor(() => expect(createCompletedTimeEntry).toHaveBeenCalled());
    expect(createCompletedTimeEntry).toHaveBeenCalledWith(9, {
      description: "To delete", project_id: undefined, tags: ["urgent"],
      start: "2026-07-28T09:00:00Z", stop: "2026-07-28T09:30:00Z",
    });
  });

  it("double-Escape quits without submitting an in-progress wizard", async () => {
    await writeCacheEntry(join(dir, "projects.json"), [], SYNCED_AT);
    await writeCacheEntry(join(dir, "time_entries.json"), [], SYNCED_AT);
    const createTimeEntry = vi.fn();
    const ctx = makeCtx(dir, { createTimeEntry });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    instance = render(<App ctx={ctx} config={config} />);
    await waitForText(instance, "[q] quit");
    await type(instance, "n");
    await waitForText(instance, "New timer");
    await type(instance, "Abandoned");
    await type(instance, ESC);
    await type(instance, ESC);

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(createTimeEntry).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
