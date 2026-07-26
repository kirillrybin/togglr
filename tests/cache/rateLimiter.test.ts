import { describe, expect, it } from "vitest";
import { pruneOld, canSpend, recordRequest, type RateLimiterState } from "../../src/cache/rateLimiter.js";

describe("rateLimiter", () => {
  it("prunes timestamps older than one hour", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    const state: RateLimiterState = {
      timestamps: [
        "2026-07-26T10:30:00Z",
        "2026-07-26T11:30:00Z",
        "2026-07-26T11:59:00Z",
      ],
    };
    const pruned = pruneOld(state, now);
    expect(pruned.timestamps).toEqual(["2026-07-26T11:30:00Z", "2026-07-26T11:59:00Z"]);
  });

  it("canSpend is false once the budget is reached within the window", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    const state: RateLimiterState = {
      timestamps: Array.from({ length: 5 }, () => "2026-07-26T11:50:00Z"),
    };
    expect(canSpend(state, now, 5)).toBe(false);
    expect(canSpend(state, now, 6)).toBe(true);
  });

  it("recordRequest appends a pruned timestamp for now", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    const state: RateLimiterState = { timestamps: ["2020-01-01T00:00:00Z"] };
    const updated = recordRequest(state, now);
    expect(updated.timestamps).toEqual([now.toISOString()]);
  });
});
