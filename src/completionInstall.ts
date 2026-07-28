import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RC_FILE_BY_SHELL: Record<string, string> = {
  bash: ".bashrc",
  zsh: ".zshrc",
};

export function rcFilePath(shell: string, homeDir: string = os.homedir()): string | null {
  const rc = RC_FILE_BY_SHELL[shell];
  return rc ? path.join(homeDir, rc) : null;
}

function evalLine(shell: string): string {
  return `eval "$(toggl completion ${shell})"`;
}

export interface InstallResult {
  file: string;
  alreadyInstalled: boolean;
}

export async function installCompletion(shell: string, homeDir: string = os.homedir()): Promise<InstallResult> {
  const file = rcFilePath(shell, homeDir);
  if (!file) throw new Error(`Unknown shell: "${shell}". Use "bash" or "zsh".`);

  const line = evalLine(shell);
  const existing = await fs.readFile(file, "utf-8").catch(() => "");
  if (existing.includes(line)) {
    return { file, alreadyInstalled: true };
  }

  // Separate our block from whatever's already there with exactly one blank
  // line — covers an empty file, one that already ends in a blank line, one
  // that ends in a single newline, and one with no trailing newline at all
  // (which would otherwise glue our comment onto the end of the last line).
  const separator = existing.length === 0 || existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n")
      ? "\n"
      : "\n\n";
  const block = `# togglr shell completion\n${line}\n`;
  await fs.appendFile(file, separator + block, "utf-8");
  return { file, alreadyInstalled: false };
}
