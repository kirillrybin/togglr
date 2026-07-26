import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { Dashboard } from "../../src/tui/Dashboard.js";

const noop = () => {};

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
        inputValue=""
        onInputChange={noop}
        onInputSubmit={noop}
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
        recentEntries={[{ description: "Standup", totalSeconds: 900, projectId: null }]}
        stale={false}
        selectedIndex={0}
        inputMode={false}
        inputValue=""
        onInputChange={noop}
        onInputSubmit={noop}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Coding on togglr");
    expect(frame).toContain("00:42:17");
    expect(frame).toContain("Standup");
  });

  it("shows a stale indicator when the cache could not be refreshed", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={true} selectedIndex={0}
        inputMode={false} inputValue="" onInputChange={noop} onInputSubmit={noop}
      />
    );
    expect(lastFrame()).toContain("stale");
  });

  it("shows an inline prompt with the current input value when in new-timer input mode", () => {
    const { lastFrame } = render(
      <Dashboard
        timer={null} elapsedSeconds={0} todayTotalSeconds={0} weekTotalSeconds={0}
        recentEntries={[]} stale={false} selectedIndex={0}
        inputMode={true} inputValue="Coding" onInputChange={noop} onInputSubmit={noop}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("New timer");
    expect(frame).toContain("Coding");
  });
});
