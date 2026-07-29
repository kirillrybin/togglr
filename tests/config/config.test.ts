import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    const config = { apiToken: "abc", workspaceId: 1, cacheTtl: DEFAULT_TTL, showProjectColors: true };
    await writeConfig(dir, config);
    expect(await readConfig(dir)).toEqual(config);
    const mode = statSync(join(dir, "config.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("backfills showProjectColors as false for a config.json written before that field existed", async () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ apiToken: "abc", workspaceId: 1, cacheTtl: DEFAULT_TTL }),
      "utf-8"
    );

    const config = await readConfig(dir);

    expect(config?.showProjectColors).toBe(false);
  });
});
