import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ZodType } from "zod";

// ---------------------------------------------------------------------------
// Shared JSON file I/O for ~/.inteligir stores
// ---------------------------------------------------------------------------

const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

const cache = new Map<string, unknown>();

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

export function readJson<T>(filePath: string, schema: ZodType<T>): T | null {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached as T;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (result.success) {
      cache.set(filePath, result.data);
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  cache.set(filePath, data);
}
