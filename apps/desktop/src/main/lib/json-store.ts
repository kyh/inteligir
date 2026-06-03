import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ZodType } from "zod";

const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

export type FsAdapter = {
  read: (filePath: string) => string | null;
  write: (filePath: string, content: string) => void;
};

// Write to <path>.tmp then rename — atomic on POSIX + NTFS, so a crash mid-write
// leaves the previous file intact instead of a half-written one.
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
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, filePath);
  },
};

export type JsonStoreOptions = {
  fs?: FsAdapter;
  /**
   * Called once when a corrupt file (unparseable JSON or schema-rejected) is
   * detected. Receives the path the corrupt file was moved to. Lets callers
   * surface a warning to the user instead of silently losing state.
   */
  onCorrupt?: (backupPath: string) => void;
};

export class JsonStore<T> {
  private cache: T | undefined;
  private readonly fs: FsAdapter;
  private readonly onCorrupt: ((backupPath: string) => void) | undefined;

  constructor(
    private readonly filePath: string,
    private readonly schema: ZodType<T>,
    private readonly defaultValue: T,
    options: JsonStoreOptions | FsAdapter = {},
  ) {
    // Back-compat: tests pass an FsAdapter directly as the fourth arg.
    const opts: JsonStoreOptions =
      "read" in options && "write" in options ? { fs: options } : options;
    this.fs = opts.fs ?? realFs;
    this.onCorrupt = opts.onCorrupt;
  }

  /**
   * Read + validate. Returns the defaultValue if the file is missing or if
   * the file is unrecoverable (unparseable / schema-rejected); in the
   * recoverable cases the corrupt file is moved aside to <path>.corrupt-<ts>
   * and `onCorrupt` (if set) is called with the backup path so callers can
   * surface a warning.
   */
  read(): T {
    if (this.cache !== undefined) return structuredClone(this.cache);
    const raw = this.fs.read(this.filePath);
    if (raw === null) {
      this.cache = structuredClone(this.defaultValue);
      return structuredClone(this.cache);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.recoverCorrupt(raw);
      return structuredClone(this.defaultValue);
    }
    const result = this.schema.safeParse(parsed);
    if (!result.success) {
      this.recoverCorrupt(raw);
      return structuredClone(this.defaultValue);
    }
    this.cache = result.data;
    return structuredClone(this.cache);
  }

  write(data: T): void {
    this.cache = structuredClone(data);
    this.fs.write(this.filePath, JSON.stringify(this.cache, null, 2));
  }

  update(fn: (current: T) => T): T {
    const updated = fn(this.read());
    this.write(updated);
    return updated;
  }

  /** Invalidate cache — next read() will re-read from disk. */
  invalidate(): void {
    this.cache = undefined;
  }

  private recoverCorrupt(raw: string): void {
    const backupPath = `${this.filePath}.corrupt-${process.hrtime.bigint()}`;
    try {
      this.fs.write(backupPath, raw);
    } catch {
      // Recovery is best-effort; if the disk is dead we can't help.
    }
    this.cache = structuredClone(this.defaultValue);
    this.onCorrupt?.(backupPath);
  }
}
