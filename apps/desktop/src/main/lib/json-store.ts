import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ZodType } from "zod";

// ---------------------------------------------------------------------------
// Shared JSON file I/O for ~/.inteligir stores
// ---------------------------------------------------------------------------

const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

// ---------------------------------------------------------------------------
// Filesystem adapter — injectable for testing
// ---------------------------------------------------------------------------

export type FsAdapter = {
  read: (filePath: string) => string | null;
  write: (filePath: string, content: string) => void;
};

const realFs: FsAdapter = {
  read: (filePath) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
  write: (filePath, content) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  },
};

// ---------------------------------------------------------------------------
// JsonStore<T> — typed, validated, cached file store
// ---------------------------------------------------------------------------

export class JsonStore<T> {
  private cache: T | undefined;

  constructor(
    private readonly filePath: string,
    private readonly schema: ZodType<T>,
    private readonly defaultValue: T,
    private readonly fs: FsAdapter = realFs,
  ) {}

  read(): T {
    if (this.cache !== undefined) return this.cache;
    const raw = this.fs.read(this.filePath);
    if (raw === null) {
      this.cache = this.defaultValue;
      return this.cache;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const result = this.schema.safeParse(parsed);
      this.cache = result.success ? result.data : this.defaultValue;
    } catch {
      this.cache = this.defaultValue;
    }
    return this.cache;
  }

  write(data: T): void {
    this.cache = data;
    this.fs.write(this.filePath, JSON.stringify(data, null, 2));
  }

  /** Update data via a transform function. Reads, transforms, writes atomically. */
  update(fn: (current: T) => T): T {
    const updated = fn(this.read());
    this.write(updated);
    return updated;
  }

  /** Invalidate cache — next read() will re-read from disk. */
  invalidate(): void {
    this.cache = undefined;
  }
}
