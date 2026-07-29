import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext } from "../src/bootstrap.js";
import { writeConfig } from "../src/config/config.js";

describe("buildContext", () => {
  let configDir: string;
  let cacheDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "togglr-bootstrap-config-"));
    cacheDir = mkdtempSync(join(tmpdir(), "togglr-bootstrap-cache-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("builds a SyncContext from an existing config without prompting", async () => {
    await writeConfig(configDir, {
      apiToken: "t", workspaceId: 9, cacheTtl: { projects: 21600, timeEntries: 300 }, showProjectColors: true,
    });
    const { ctx, config } = await buildContext({ configDir, cacheDir });
    expect(config.workspaceId).toBe(9);
    expect(ctx.cacheDir).toBe(cacheDir);
    expect(ctx.budgetPerHour).toBe(25);
  });
});
