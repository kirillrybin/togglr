import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { Dashboard, computeVisibleWindow, type RecentEntryView } from "../../src/tui/Dashboard.js";
import { formatTimeHHMM } from "../../src/commands/add.js";

const noop = () => {};

function makeEntries(count: number): RecentEntryView[] {
  return Array.from({ length: count }, (_, i) => ({
    entryId: i,
    description: `Entry ${i}`,
    totalSeconds: 60,
    projectId: null,
    projectName: null,
    start: "2026-07-26T11:00:00Z",
    stop: "2026-07-26T11:01:00Z",
  }));
}

describe("computeVisibleWindow", () => {
  it("shows everything when total fits within the visible count", () => {
    expect(computeVisibleWindow(3, 0, 5)).toEqual({ start: 0, end: 3 });
    expect(computeVisibleWindow(5, 4, 5)).toEqual({ start: 0, end: 5 });
  });

  it("keeps the window within bounds at the start of a longer list", () => {
    expect(computeVisibleWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(computeVisibleWindow(20, 1, 5)).toEqual({ start: 0, end: 5 });
  });

  it("keeps the window within bounds at the end of a longer list", () => {
    expect(computeVisibleWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
    expect(computeVisibleWindow(20, 18, 5)).toEqual({ start: 15, end: 20 });
  });

  it("centers the window around the selection in the middle of a longer list", () => {
    expect(computeVisibleWindow(20, 10, 5)).toEqual({ start: 8, end: 13 });
  });
});

describe("Dashboard", () => {
  it("shows 'No timer running' when there is no active timer", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null}
        elapsedSeconds={0}
        todayTotalSeconds={0}
        weekTotalSeconds={0}
        recentEntries={[]}
        stale={false}
        selectedIndex={0}
        inputMode={false}
        inputLabel=""
        inputValue=""
        onInputChange={noop}
        onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    expect(lastFrame()).toContain("No timer running");
  });

  it("shows the active timer description and elapsed time", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={{ entryId: 1, description: "Coding on togglr", projectId: null, workspaceId: 9, startedAt: "2026-07-26T11:00:00Z" }}
        elapsedSeconds={2537}
        todayTotalSeconds={11520}
        weekTotalSeconds={50700}
        recentEntries={[{ entryId: 2, description: "Standup", totalSeconds: 900, projectId: 5, projectName: "Website", start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:15:00Z" }]}
        stale={false}
        selectedIndex={0}
        inputMode={false}
        inputLabel=""
        inputValue=""
        onInputChange={noop}
        onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Coding on togglr");
    expect(frame).toContain("00:42:17");
    expect(frame).toContain("Standup");
    expect(frame).toContain("[Website]");
    expect(frame).toContain(`(${formatTimeHHMM("2026-07-26T11:00:00Z")}–${formatTimeHHMM("2026-07-26T11:15:00Z")})`);
  });

  it("shows no project marker when a recent entry has no project", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[{ entryId: 1, description: "Misc", totalSeconds: 60, projectId: null, projectName: null, start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:01:00Z" }]}
        stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    const frame = lastFrame() ?? "";
    // No "[ProjectName]" marker inserted between the description and the
    // duration when there's no project (the footer hint has its own
    // brackets, so check the entry's own line specifically).
    expect(frame).toContain("Misc — 00:01:00");
  });

  it("shows a stale indicator when the cache could not be refreshed", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={true} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    expect(lastFrame()).toContain("stale");
  });

  it("shows an inline prompt with the given label and current input value", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputLabel="New timer" inputValue="Coding" onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("New timer");
    expect(frame).toContain("Coding");
  });

  it("shows a different label for an edit-flow prompt", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputLabel="Edit start (HH:MM)" inputValue="09:00" onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Edit start (HH:MM)");
    expect(frame).toContain("09:00");
  });

  it("only renders the visible window and shows scroll indicators when there are more entries than fit", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={makeEntries(20)} stale={false} selectedIndex={10}
        inputMode={false} inputLabel="" inputValue="" onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    const frame = lastFrame() ?? "";
    // Window centered on index 10 out of 20, 5 visible -> entries 8..12.
    expect(frame).toContain("Entry 8");
    expect(frame).toContain("Entry 12");
    expect(frame).not.toContain("Entry 0");
    expect(frame).not.toContain("Entry 19");
    expect(frame).toContain("↑ 8 more");
    expect(frame).toContain("↓ 7 more");
  });

  it("shows no scroll indicators when every entry fits in the visible window", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={makeEntries(3)} stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("more");
  });

  it("shows a delete confirmation prompt naming the entry, instead of the normal hint", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription="Standup"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain('Delete "Standup"?');
    expect(frame).toContain("y/n");
    expect(frame).not.toContain("[q] quit");
  });
});
