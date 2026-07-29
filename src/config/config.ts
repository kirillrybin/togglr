import fs from "node:fs/promises";
import path from "node:path";
import { readJson } from "../cache/store.js";

export interface Config {
  apiToken: string;
  workspaceId: number;
  cacheTtl: { projects: number; timeEntries: number };
  showProjectColors: boolean;
}

export const DEFAULT_TTL = { projects: 21600, timeEntries: 300 };
export const DEFAULT_SHOW_PROJECT_COLORS = false;

function configFile(configDir: string): string {
  return path.join(configDir, "config.json");
}

export async function readConfig(configDir: string): Promise<Config | null> {
  // Read as Partial: a config.json written before showProjectColors existed
  // really is missing that field at runtime, whatever the full Config type
  // claims — the fallback below is what backfills it, not just documentation.
  const raw = await readJson<Partial<Config>>(configFile(configDir));
  if (!raw) return null;
  return { showProjectColors: DEFAULT_SHOW_PROJECT_COLORS, ...raw } as Config;
}

export async function writeConfig(configDir: string, config: Config): Promise<void> {
  const file = configFile(configDir);
  await fs.mkdir(configDir, { recursive: true });
  // `mode` closes the window in which the plaintext-token file would otherwise
  // exist world-readable between writeFile and chmod. The explicit chmod stays
  // as a belt-and-suspenders step because `mode` is still subject to umask.
  await fs.writeFile(file, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.chmod(file, 0o600);
}
