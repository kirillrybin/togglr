import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConfig } from "../../src/config/ensureConfig.js";
import { readConfig } from "../../src/config/config.js";

describe("ensureConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-ensure-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the existing config without prompting when one is present", async () => {
    const { writeConfig, DEFAULT_TTL } = await import("../../src/config/config.js");
    const existing = { apiToken: "existing", workspaceId: 7, cacheTtl: DEFAULT_TTL, showProjectColors: true };
    await writeConfig(dir, existing);
    const prompt = vi.fn();
    const result = await ensureConfig(dir, { prompt });
    expect(result).toEqual(existing);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("prompts for a token, fetches the default workspace, and persists config", async () => {
    const prompt = vi.fn().mockResolvedValue("newtoken");
    const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 42 });
    const createClient = vi.fn().mockReturnValue({ getMe });

    const result = await ensureConfig(dir, { prompt, createClient });

    expect(result.apiToken).toBe("newtoken");
    expect(result.workspaceId).toBe(42);
    expect(result.showProjectColors).toBe(false);
    expect(createClient).toHaveBeenCalledWith("newtoken");
    expect(await readConfig(dir)).toEqual(result);
  });
});
