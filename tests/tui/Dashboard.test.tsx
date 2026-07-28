import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import {
  Dashboard,
  computeVisibleWindow,
  filterProjectSuggestions,
  filterTagSuggestions,
  applyTagSuggestion,
  filterEntries,
  type RecentEntryView,
} from "../../src/tui/Dashboard.js";
import { formatTimeHHMM } from "../../src/commands/add.js";
import type { Project } from "../../src/domain/models.js";

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
    tags: [],
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
        inputValue="" inputResetKey={0}
        onInputChange={noop}
        onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
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
        recentEntries={[{ entryId: 2, description: "Standup", totalSeconds: 900, projectId: 5, projectName: "Website", start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:15:00Z", tags: [] }]}
        stale={false}
        selectedIndex={0}
        inputMode={false}
        inputLabel=""
        inputValue="" inputResetKey={0}
        onInputChange={noop}
        onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
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
        recentEntries={[{ entryId: 1, description: "Misc", totalSeconds: 60, projectId: null, projectName: null, start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:01:00Z", tags: [] }]}
        stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    // No "[ProjectName]" marker inserted between the description and the
    // duration when there's no project (the footer hint has its own
    // brackets, so check the entry's own line specifically).
    expect(frame).toContain("Misc — 00:01:00");
  });

  it("shows tags on an entry's row, hashtag-prefixed", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[{ entryId: 1, description: "Misc", totalSeconds: 60, projectId: null, projectName: null, start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:01:00Z", tags: ["urgent", "billable"] }]}
        stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#urgent #billable");
  });

  it("shows a stale indicator when the cache could not be refreshed", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={true} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    expect(lastFrame()).toContain("stale");
  });

  it("shows an inline prompt with the given label and current input value", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputLabel="New timer" inputValue="Coding" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
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
        inputMode={true} inputLabel="Edit start (HH:MM)" inputValue="09:00" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
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
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
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
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
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
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription="Standup" lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain('Delete "Standup"?');
    expect(frame).toContain("y/n");
    expect(frame).not.toContain("[q] quit");
  });

  it("shows an undo hint after a delete, naming the deleted entry", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription="Standup"
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain('Deleted "Standup"');
    expect(frame).toContain("'u' to undo");
  });

  it("hides the undo hint while a wizard prompt or delete confirmation is showing", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputLabel="New timer" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription="Standup"
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Deleted");
  });

  it("shows filtered project suggestions in the input box, with the highlighted one inverted", () => {
    const projects: Project[] = [
      { id: 1, name: "Website", color: "#fff", workspaceId: 9 },
      { id: 2, name: "Website Redesign", color: "#fff", workspaceId: 9 },
      { id: 3, name: "Mobile app", color: "#fff", workspaceId: 9 },
    ];
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputLabel="Project (blank = none)" inputValue="web" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={filterProjectSuggestions(projects, "web")}
        selectedSuggestionIndex={1}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Website");
    expect(frame).toContain("Website Redesign");
    expect(frame).not.toContain("Mobile app");
  });

  it("shows tag suggestions with a Tab hint on the highlighted one", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputLabel="Tags" inputValue="bi" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        tagSuggestions={["billable"]}
        selectedSuggestionIndex={0}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("billable");
    expect(frame).toContain("Tab to insert");
  });

  it("shows a filter indicator with the match count when a search query is active", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={makeEntries(2)} stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery="entry"
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain('Filter: "entry" (2 matches)');
  });

  it("shows no filter indicator when there's no active search query", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={makeEntries(2)} stale={false} selectedIndex={0}
        inputMode={false} inputLabel="" inputValue="" inputResetKey={0} onInputChange={noop} onInputSubmit={noop}
        confirmDeleteDescription={null} lastDeletedDescription={null}
        projectSuggestions={[]}
        selectedSuggestionIndex={null}
        tagSuggestions={[]}
        searchQuery=""
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Filter:");
  });
});

describe("filterProjectSuggestions", () => {
  const projects: Project[] = [
    { id: 1, name: "Website", color: "#fff", workspaceId: 9 },
    { id: 2, name: "Website Redesign", color: "#fff", workspaceId: 9 },
    { id: 3, name: "Mobile app", color: "#fff", workspaceId: 9 },
  ];

  it("matches case-insensitively on a substring of the name", () => {
    expect(filterProjectSuggestions(projects, "web")).toEqual([projects[0], projects[1]]);
    expect(filterProjectSuggestions(projects, "APP")).toEqual([projects[2]]);
  });

  it("returns nothing for a blank query", () => {
    expect(filterProjectSuggestions(projects, "")).toEqual([]);
    expect(filterProjectSuggestions(projects, "   ")).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterProjectSuggestions(projects, "nope")).toEqual([]);
  });
});

describe("filterTagSuggestions", () => {
  const knownTags = ["urgent", "billable", "bug", "feature"];

  it("matches case-insensitively against the segment being typed, not the whole field", () => {
    expect(filterTagSuggestions(knownTags, "bi")).toEqual(["billable"]);
    expect(filterTagSuggestions(knownTags, "urgent, BU")).toEqual(["bug"]);
  });

  it("returns nothing once a tag has just been finished (trailing comma, no partial yet)", () => {
    expect(filterTagSuggestions(knownTags, "urgent, ")).toEqual([]);
  });

  it("excludes tags already present earlier in the field", () => {
    expect(filterTagSuggestions(knownTags, "bug, b")).toEqual(["billable"]);
  });

  it("returns nothing for a blank field", () => {
    expect(filterTagSuggestions(knownTags, "")).toEqual([]);
  });
});

describe("applyTagSuggestion", () => {
  it("replaces the segment being typed with the picked tag, ready for the next one", () => {
    expect(applyTagSuggestion("bi", "billable")).toBe("billable, ");
  });

  it("keeps everything before the last comma untouched", () => {
    expect(applyTagSuggestion("urgent, bu", "bug")).toBe("urgent, bug, ");
  });
});

describe("filterEntries", () => {
  const entries: RecentEntryView[] = [
    { entryId: 1, description: "Fix login bug", totalSeconds: 60, projectId: 5, projectName: "Website", start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:01:00Z", tags: ["urgent"] },
    { entryId: 2, description: "Standup", totalSeconds: 60, projectId: null, projectName: null, start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:01:00Z", tags: ["meeting"] },
    { entryId: 3, description: "Write docs", totalSeconds: 60, projectId: 7, projectName: "Docs", start: "2026-07-26T11:00:00Z", stop: "2026-07-26T11:01:00Z", tags: [] },
  ];

  it("returns everything for a blank query", () => {
    expect(filterEntries(entries, "")).toEqual(entries);
    expect(filterEntries(entries, "   ")).toEqual(entries);
  });

  it("matches case-insensitively on the description", () => {
    expect(filterEntries(entries, "login")).toEqual([entries[0]]);
  });

  it("matches on the project name", () => {
    expect(filterEntries(entries, "docs")).toEqual([entries[2]]);
  });

  it("matches on a tag", () => {
    expect(filterEntries(entries, "urgent")).toEqual([entries[0]]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterEntries(entries, "nope")).toEqual([]);
  });
});
