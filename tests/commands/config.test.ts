import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigShow, runConfigUpdate, formatConfig, maskToken } from "../../src/commands/config.js";
import { readConfig, writeConfig, DEFAULT_TTL } from "../../src/config/config.js";

describe("commands/config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "togglr-config-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("maskToken", () => {
    it("keeps the first and last 4 characters, masking the rest", () => {
      expect(maskToken("abcd1234efgh5678")).toBe("abcd********5678");
    });

    it("fully masks a short token", () => {
      expect(maskToken("short")).toBe("*****");
    });
  });

  describe("runConfigShow", () => {
    it("throws when no config exists yet", async () => {
      await expect(runConfigShow(dir)).rejects.toThrow(/No config found/);
    });

    it("formats the existing config with the token masked", async () => {
      await writeConfig(dir, { apiToken: "abcd1234efgh5678", workspaceId: 9, cacheTtl: DEFAULT_TTL, showProjectColors: true });

      const output = await runConfigShow(dir);

      expect(output).toContain("abcd********5678");
      expect(output).not.toContain("abcd1234efgh5678");
      expect(output).toContain("Workspace ID: 9");
    });
  });

  describe("runConfigUpdate", () => {
    it("throws when no config exists yet", async () => {
      await expect(runConfigUpdate(dir, { workspaceId: 5 })).rejects.toThrow(/No config found/);
    });

    it("updates just the workspace id, leaving everything else untouched", async () => {
      await writeConfig(dir, { apiToken: "t", workspaceId: 9, cacheTtl: DEFAULT_TTL, showProjectColors: true });

      const next = await runConfigUpdate(dir, { workspaceId: 42 });

      expect(next).toEqual({ apiToken: "t", workspaceId: 42, cacheTtl: DEFAULT_TTL, showProjectColors: true });
      expect(await readConfig(dir)).toEqual(next);
    });

    it("updates showProjectColors on its own", async () => {
      await writeConfig(dir, { apiToken: "t", workspaceId: 9, cacheTtl: DEFAULT_TTL, showProjectColors: true });

      const next = await runConfigUpdate(dir, { showProjectColors: false });

      expect(next.showProjectColors).toBe(false);
      expect(next.workspaceId).toBe(9);
    });

    it("updates only the given cache TTL, leaving the other one untouched", async () => {
      await writeConfig(dir, { apiToken: "t", workspaceId: 9, cacheTtl: DEFAULT_TTL, showProjectColors: true });

      const next = await runConfigUpdate(dir, { cacheTtlProjects: 999 });

      expect(next.cacheTtl).toEqual({ projects: 999, timeEntries: DEFAULT_TTL.timeEntries });
    });

    it("prompts for a new token and re-detects the default workspace", async () => {
      await writeConfig(dir, { apiToken: "old", workspaceId: 9, cacheTtl: DEFAULT_TTL, showProjectColors: true });
      const prompt = vi.fn().mockResolvedValue("newtoken");
      const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 77 });
      const createClient = vi.fn().mockReturnValue({ getMe });

      const next = await runConfigUpdate(dir, { newToken: true }, { prompt, createClient });

      expect(createClient).toHaveBeenCalledWith("newtoken");
      expect(next.apiToken).toBe("newtoken");
      expect(next.workspaceId).toBe(77);
    });

    it("applies an explicit --workspace override on top of a re-detected one", async () => {
      await writeConfig(dir, { apiToken: "old", workspaceId: 9, cacheTtl: DEFAULT_TTL, showProjectColors: true });
      const prompt = vi.fn().mockResolvedValue("newtoken");
      const getMe = vi.fn().mockResolvedValue({ id: 1, default_workspace_id: 77 });
      const createClient = vi.fn().mockReturnValue({ getMe });

      const next = await runConfigUpdate(dir, { newToken: true, workspaceId: 5 }, { prompt, createClient });

      expect(next.workspaceId).toBe(5);
    });
  });

  describe("formatConfig", () => {
    it("includes the masked token, workspace id, both cache TTLs, and the project-colors setting", () => {
      const output = formatConfig({
        apiToken: "abcd1234efgh5678", workspaceId: 3, cacheTtl: { projects: 60, timeEntries: 30 }, showProjectColors: true,
      });
      expect(output).toContain("abcd********5678");
      expect(output).toContain("Workspace ID: 3");
      expect(output).toContain("projects=60s");
      expect(output).toContain("time entries=30s");
      expect(output).toContain("Project colors: on");
    });

    it("shows the project-colors setting as off when disabled", () => {
      const output = formatConfig({
        apiToken: "t", workspaceId: 3, cacheTtl: { projects: 60, timeEntries: 30 }, showProjectColors: false,
      });
      expect(output).toContain("Project colors: off");
    });
  });
});
