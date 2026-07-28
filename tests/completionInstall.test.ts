import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCompletion, rcFilePath } from "../src/completionInstall.js";

describe("rcFilePath", () => {
  it("maps bash to ~/.bashrc and zsh to ~/.zshrc", () => {
    expect(rcFilePath("bash", "/home/x")).toBe("/home/x/.bashrc");
    expect(rcFilePath("zsh", "/home/x")).toBe("/home/x/.zshrc");
  });

  it("returns null for an unsupported shell", () => {
    expect(rcFilePath("fish", "/home/x")).toBeNull();
  });
});

describe("installCompletion", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "togglr-completion-install-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("throws for an unsupported shell", async () => {
    await expect(installCompletion("fish", home)).rejects.toThrow(/Unknown shell/);
  });

  it("creates the rc file with the eval line when none exists yet", async () => {
    const { file, alreadyInstalled } = await installCompletion("zsh", home);

    expect(alreadyInstalled).toBe(false);
    expect(file).toBe(join(home, ".zshrc"));
    const contents = readFileSync(file, "utf-8");
    expect(contents).toContain('eval "$(toggl completion zsh)"');
  });

  it("appends to an existing rc file, separated by exactly one blank line", async () => {
    const file = join(home, ".bashrc");
    writeFileSync(file, "export PATH=/usr/local/bin:$PATH\n", "utf-8");

    await installCompletion("bash", home);

    const contents = readFileSync(file, "utf-8");
    expect(contents).toBe(
      "export PATH=/usr/local/bin:$PATH\n\n# togglr shell completion\neval \"$(toggl completion bash)\"\n"
    );
  });

  it("adds a newline before the block when the existing file doesn't end in one", async () => {
    const file = join(home, ".zshrc");
    writeFileSync(file, "export PATH=/usr/local/bin:$PATH", "utf-8");

    await installCompletion("zsh", home);

    const contents = readFileSync(file, "utf-8");
    expect(contents).toBe(
      "export PATH=/usr/local/bin:$PATH\n\n# togglr shell completion\neval \"$(toggl completion zsh)\"\n"
    );
  });

  it("is idempotent: running it twice doesn't duplicate the line", async () => {
    await installCompletion("zsh", home);
    const first = readFileSync(join(home, ".zshrc"), "utf-8");

    const second = await installCompletion("zsh", home);

    expect(second.alreadyInstalled).toBe(true);
    expect(readFileSync(join(home, ".zshrc"), "utf-8")).toBe(first);
  });

  it("doesn't confuse the bash and zsh eval lines with each other", async () => {
    const file = join(home, ".zshrc");
    writeFileSync(file, 'eval "$(toggl completion bash)"\n', "utf-8");

    const { alreadyInstalled } = await installCompletion("zsh", home);

    expect(alreadyInstalled).toBe(false);
    expect(readFileSync(file, "utf-8")).toContain('eval "$(toggl completion zsh)"');
  });
});
