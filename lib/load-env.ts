import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnvFile(filePath: string, target: Record<string, string>): void {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) target[key] = value;
  }
}

/** Load `.env` then `.env.local` for Node scripts (Next.js loads these automatically). */
export function loadEnvFiles(): void {
  const shellKeys = new Set(Object.keys(process.env));
  const merged: Record<string, string> = {};
  const root = process.cwd();
  parseEnvFile(path.join(root, ".env"), merged);
  parseEnvFile(path.join(root, ".env.local"), merged);
  for (const [key, value] of Object.entries(merged)) {
    if (!shellKeys.has(key)) process.env[key] = value;
  }
}
