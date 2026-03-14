import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ZodType } from "zod";

// ---------------------------------------------------------------------------
// Shared JSON/JSONL file I/O for ~/.inteligir stores
// ---------------------------------------------------------------------------

const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

const cache = new Map<string, unknown>();

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

export function readJson<T>(filePath: string, schema: ZodType<T>): T | null {
  const cached = cache.get(filePath);
  if (cached !== undefined) {
    const result = schema.safeParse(cached);
    return result.success ? result.data : null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (result.success) {
      cache.set(filePath, parsed);
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

export function appendJsonl(filePath: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
}

export function readJsonl<T>(filePath: string, schema: ZodType<T>): T[] {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    const entries: T[] = [];
    for (const line of lines) {
      try {
        const result = schema.safeParse(JSON.parse(line));
        if (result.success) entries.push(result.data);
      } catch {
        // skip malformed line
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function clearFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist
  }
  cache.delete(filePath);
}
