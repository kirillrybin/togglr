import os from "node:os";
import path from "node:path";

export function getCacheDir(root?: string): string {
  return root ?? path.join(os.homedir(), ".cache", "togglr");
}

export function getConfigDir(root?: string): string {
  return root ?? path.join(os.homedir(), ".config", "togglr");
}
