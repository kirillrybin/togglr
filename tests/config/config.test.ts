import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig, DEFAULT_TTL } from "../../src/config/config.js";

describe("config/config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-config-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no config file exists", async () => {
    expect(await readConfig(dir)).toBeNull();
  });

  it("round-trips config and writes it with file mode 600", async () => {
    const config = { apiToken: "abc", workspaceId: 1, cacheTtl: DEFAULT_TTL };
    await writeConfig(dir, config);
    expect(await readConfig(dir)).toEqual(config);
    const mode = statSync(join(dir, "config.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
