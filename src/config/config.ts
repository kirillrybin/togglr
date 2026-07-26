import fs from "node:fs/promises";
import path from "node:path";
import { readJson } from "../cache/store.js";

export interface Config {
  apiToken: string;
  workspaceId: number;
  cacheTtl: { projects: number; timeEntries: number };
}

export const DEFAULT_TTL = { projects: 21600, timeEntries: 300 };

function configFile(configDir: string): string {
  return path.join(configDir, "config.json");
}

export async function readConfig(configDir: string): Promise<Config | null> {
  return readJson<Config>(configFile(configDir));
}

export async function writeConfig(configDir: string, config: Config): Promise<void> {
  const file = configFile(configDir);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2), "utf-8");
  await fs.chmod(file, 0o600);
}
