import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

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

export type JsonStoreOptions<T> = {
  fs?: FsAdapter;
  /**
   * Called once when a corrupt file (unparseable JSON or schema-rejected) is
   * detected. Receives the path the corrupt file was moved to.
   */
  onCorrupt?: (backupPath: string) => void;
  /**
   * Coerce the validated wire/disk shape into the in-memory type the store
   * exposes. Throws to reject the read the same way a Value.Check failure
   * does — the file is moved aside to .corrupt-<ts> and the cache reverts
   * to the default.
   */
  decode?: (raw: unknown) => T;
  /**
   * Inverse of `decode` — used when writing back to disk. Defaults to identity.
   */
  encode?: (value: T) => unknown;
};

export class JsonStore<T> {
  private cache: T | undefined;
  // One-way kill switch — once `close()` runs, every subsequent write/update
  // is a no-op. This prevents a stale ShellManager reference (captured before
  // resetShellCache) from resurrecting `~/.inteligir/` between resetShellCache
  // and the recursive `fs.rmSync(AGENT_DIR)` later in teardownResources: any
  // such write would have re-created the dir via the `mkdirSync(dirname)` in
  // `realFs.write`, undoing the deletion.
  private closed = false;
  private readonly fs: FsAdapter;
  private readonly onCorrupt: ((backupPath: string) => void) | undefined;
  private readonly decode: (raw: unknown) => T;
  private readonly encode: (value: T) => unknown;

  constructor(
    private readonly filePath: string,
    private readonly schema: TSchema,
    private readonly defaultValue: T,
    options: JsonStoreOptions<T> | FsAdapter = {},
  ) {
    // Back-compat: tests pass an FsAdapter directly as the fourth arg.
    const opts: JsonStoreOptions<T> =
      "read" in options && "write" in options ? { fs: options } : options;
    this.fs = opts.fs ?? realFs;
    this.onCorrupt = opts.onCorrupt;
    this.decode = opts.decode ?? ((raw) => raw as T);
    this.encode = opts.encode ?? ((value) => value);
  }

  /**
   * Read + validate. Returns the defaultValue if the file is missing or if
   * the file is unrecoverable (unparseable / schema-rejected); in the
   * recoverable cases the corrupt file is moved aside to <path>.corrupt-<ts>
   * and `onCorrupt` (if set) is called with the backup path.
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
    if (!Value.Check(this.schema, parsed)) {
      this.recoverCorrupt(raw);
      return structuredClone(this.defaultValue);
    }
    try {
      this.cache = this.decode(parsed);
    } catch {
      this.recoverCorrupt(raw);
      return structuredClone(this.defaultValue);
    }
    return structuredClone(this.cache);
  }

  write(data: T): void {
    if (this.closed) return;
    this.cache = structuredClone(data);
    this.fs.write(this.filePath, JSON.stringify(this.encode(this.cache), null, 2));
  }

  update(fn: (current: T) => T): T {
    if (this.closed) return this.read();
    const updated = fn(this.read());
    this.write(updated);
    return updated;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  /**
   * Permanently disable writes on this store instance. Any subsequent
   * write/update is a no-op (update still returns the current read). Use this
   * before deleting the underlying directory so an in-flight handler holding
   * an old reference can't recreate the file on its way out. Idempotent.
   */
  close(): void {
    this.closed = true;
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
