import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { isRecord, toErrorMessage } from "@repo/core/ipc";

const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

export type FsAdapter = {
  read: (filePath: string) => string | null;
  write: (filePath: string, content: string, mode?: number) => void;
  /**
   * Async atomic write used by coalesced stores. `shouldAbort` is checked
   * between steps so a store closed mid-write (logout teardown) stops before
   * it can resurrect a file the caller is about to delete. Adapters without
   * it fall back to the synchronous `write`.
   */
  writeAsync?: (
    filePath: string,
    content: string,
    opts?: { mode?: number | undefined; shouldAbort?: (() => boolean) | undefined },
  ) => Promise<void>;
  /**
   * Atomic move — used to quarantine corrupt/newer-version files so they
   * stop being re-detected on every launch. Adapters without it fall back
   * to copy-on-write (backup written, original left in place).
   */
  rename?: (from: string, to: string) => void;
};

// ~/.inteligir holds credentials (pi's auth.json, secrets.json) — keep the
// directory itself owner-only. New dirs are created 0o700 by the mkdir calls
// below; this covers pre-existing installs created before the mode was set.
// Once per process: a wiped-and-recreated dir gets 0o700 from mkdir anyway.
let inteligirDirRestricted = false;
function restrictInteligirDir(filePath: string): void {
  if (inteligirDirRestricted || !filePath.startsWith(INTELIGIR_DIR + path.sep)) return;
  try {
    fs.chmodSync(INTELIGIR_DIR, 0o700);
    inteligirDirRestricted = true;
  } catch {
    // Dir may not exist yet (first write creates it 0o700) — best effort.
  }
}

function writeFileOptions(mode: number | undefined): { encoding: "utf8"; mode?: number } {
  return mode === undefined ? { encoding: "utf8" } : { encoding: "utf8", mode };
}

// Write to <path>.tmp then rename — atomic on POSIX + NTFS, so a crash mid-write
// leaves the previous file intact instead of a half-written one. `mode` applies
// to the tmp file (fresh every write), so the rename carries it to the target.
const realFs: FsAdapter = {
  read: (filePath) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
  write: (filePath, content, mode) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    restrictInteligirDir(filePath);
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, content, writeFileOptions(mode));
    fs.renameSync(tmp, filePath);
  },
  writeAsync: async (filePath, content, opts = {}) => {
    const aborted = opts.shouldAbort ?? ((): boolean => false);
    if (aborted()) return;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    restrictInteligirDir(filePath);
    if (aborted()) return;
    const tmp = `${filePath}.tmp`;
    await fs.promises.writeFile(tmp, content, writeFileOptions(opts.mode));
    if (aborted()) {
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
      return;
    }
    await fs.promises.rename(tmp, filePath);
  },
  rename: (from, to) => {
    fs.renameSync(from, to);
  },
};

/**
 * Why a file was set aside. Either way the original bytes survive at
 * `backupPath` and the store resets to its defaults — this event is the
 * user's only pointer to the backup, so it must be surfaced.
 */
export type StoreRecoveryEvent =
  | { kind: "corrupt"; filePath: string; backupPath: string; reason: string }
  | {
      kind: "newer-version";
      filePath: string;
      backupPath: string;
      fileVersion: number;
      supportedVersion: number;
    };

// Default user-facing surfacing for recovery events on stores without their
// own onRecovery. main/notifications.ts registers the OS-notification handler
// at module load; outside Electron main (vitest) nothing registers and the
// caller's console.error stays the only record. A registration seam instead
// of importing notifications keeps the json-store ↔ notifications edge
// one-way — notifications.ts itself persists through a JsonStore.
let defaultRecoveryNotifier: ((event: StoreRecoveryEvent) => void) | null = null;

export function setStoreRecoveryNotifier(notifier: (event: StoreRecoveryEvent) => void): void {
  defaultRecoveryNotifier = notifier;
}

/**
 * On-disk format version + migration registry. Every new store MUST provide
 * this — registering a migration chain without declaring the current version
 * and the unversioned-era story is not expressible. Only pre-existing stores
 * whose contents are documented as ephemeral (ui-state.json) may omit it.
 */
export type StoreVersioning = {
  /** Version the current schema describes. Files already here skip migration. */
  current: number;
  /**
   * Upgrade a file from the unversioned era (no integer `version` field).
   * Required even when no such era ever existed — throw to declare
   * unversioned files corrupt. The returned value must carry a `version`.
   */
  fromLegacy: (raw: unknown) => unknown;
  /**
   * vN→vN+1 steps keyed by source version N. Each step must write the
   * version it migrated to into the returned value.
   */
  migrations?: Readonly<Partial<Record<number, (raw: unknown) => unknown>>>;
};

export type JsonStoreOptions<T> = {
  fs?: FsAdapter | undefined;
  /**
   * Replaces the default user-facing surfacing when a file is quarantined
   * (corrupt or written by a newer build). The console.error log fires
   * unconditionally either way. Production stores should rely on the
   * default, which raises an OS notification pointing at the backup.
   */
  onRecovery?: (event: StoreRecoveryEvent) => void;
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
  /** Version + migrations for the on-disk format. Required for new stores. */
  versioning?: StoreVersioning;
  /**
   * POSIX permission bits applied to the file on every write (e.g. 0o600 for
   * credential-bearing stores). Backups written on recovery inherit it too.
   */
  mode?: number;
  /**
   * Coalesce disk writes: `write()` returns after updating the in-memory
   * cache; the file write runs asynchronously with a single in-flight write
   * plus at most one trailing write (latest cache wins). Opt-in for hot-path
   * stores (runtime-ui.json), where every renderer state tick otherwise
   * rewrites the whole file synchronously. Callers that need durability
   * (the widget flush protocol) must `await flush()`.
   */
  coalesceWrites?: boolean;
};

function readVersion(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const version = value["version"];
  return typeof version === "number" && Number.isInteger(version) ? version : null;
}

type MigrateOutcome =
  | { kind: "ok"; value: unknown; migrated: boolean }
  | { kind: "corrupt"; reason: string }
  | { kind: "newer-version"; fileVersion: number };

export class JsonStore<T> {
  private cache: T | undefined;
  // One-way kill switch — once `close()` runs, every subsequent write/update
  // is a no-op. This prevents a stale ShellManager reference (captured before
  // resetShellCache) from resurrecting `~/.inteligir/` between resetShellCache
  // and the recursive `fs.rmSync(AGENT_DIR)` later in teardownResources: any
  // such write would have re-created the dir via the `mkdirSync(dirname)` in
  // `realFs.write`, undoing the deletion.
  private closed = false;
  // Coalesced-write machinery: `dirty` means the cache is ahead of disk;
  // `writeLoop` is the single in-flight drain (null when idle).
  private dirty = false;
  private writeLoop: Promise<void> | null = null;
  private readonly fs: FsAdapter;
  private readonly onRecovery: ((event: StoreRecoveryEvent) => void) | undefined;
  private readonly decode: (raw: unknown) => T;
  private readonly encode: (value: T) => unknown;
  private readonly versioning: StoreVersioning | undefined;
  private readonly mode: number | undefined;
  private readonly coalesce: boolean;

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
    this.onRecovery = opts.onRecovery;
    // `raw as T`: the schema↔generic seam. `raw` was already Value.Check'd
    // against `schema`, but `schema: TSchema` erases its Static type, so the
    // compiler can't connect it to T. Callers omitting `decode` assert
    // Static<schema> is T.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- schema↔generic seam, see doc above
    this.decode = opts.decode ?? ((raw) => raw as T);
    this.encode = opts.encode ?? ((value) => value);
    this.versioning = opts.versioning;
    this.mode = opts.mode;
    this.coalesce = opts.coalesceWrites ?? false;
  }

  /**
   * Read + migrate + validate. Returns the defaultValue if the file is
   * missing. A file whose version is newer than `versioning.current`
   * (downgraded build) is quarantined to <path>.newer-v<N>-<ts>; an
   * unrecoverable file (unparseable / failed migration / schema-rejected)
   * is moved aside to <path>.corrupt-<ts>. Both paths log, keep the
   * original bytes at the backup path, and surface a recovery event.
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
      return this.recoverCorrupt(raw, "unparseable JSON");
    }
    let migrated = false;
    if (this.versioning) {
      const outcome = this.migrate(parsed, this.versioning);
      if (outcome.kind === "corrupt") return this.recoverCorrupt(raw, outcome.reason);
      if (outcome.kind === "newer-version") {
        return this.quarantineNewer(raw, outcome.fileVersion, this.versioning.current);
      }
      parsed = outcome.value;
      migrated = outcome.migrated;
    }
    if (!Value.Check(this.schema, parsed)) {
      return this.recoverCorrupt(raw, "schema validation failed");
    }
    try {
      this.cache = this.decode(parsed);
    } catch (err) {
      return this.recoverCorrupt(raw, `decode failed: ${toErrorMessage(err)}`);
    }
    if (migrated && !this.closed) {
      // Persist the upgraded shape so the chain doesn't re-run every launch.
      try {
        this.fs.write(this.filePath, JSON.stringify(this.encode(this.cache), null, 2), this.mode);
      } catch {
        // Best-effort: the migrated value is live in memory either way.
      }
    }
    return structuredClone(this.cache);
  }

  write(data: T): void {
    if (this.closed) return;
    this.assertWritable(data);
    this.cache = structuredClone(data);
    if (this.coalesce) {
      this.dirty = true;
      void this.ensureDrain();
      return;
    }
    this.fs.write(this.filePath, JSON.stringify(this.encode(this.cache), null, 2), this.mode);
  }

  /**
   * Write-time validation: a value whose encoded form fails the store's own
   * schema is a programmer bug. Persisting it would be worse than failing —
   * the next read would Value.Check-reject the file and corrupt-recovery
   * would quarantine it, silently wiping the user's state to defaults. Throws
   * before the cache or disk are touched (covers both sync and coalesced
   * paths) and logs unconditionally so fire-and-forget callers still leave a
   * record.
   */
  private assertWritable(data: T): void {
    const encoded = this.encode(data);
    if (Value.Check(this.schema, encoded)) return;
    const first = Value.Errors(this.schema, encoded).First();
    const detail = first ? `: ${first.path} ${first.message}` : "";
    const message = `[json-store] ${this.filePath}: refusing to write value that fails schema validation${detail}`;
    console.error(message);
    throw new Error(message);
  }

  update(fn: (current: T) => T): T {
    if (this.closed) return this.read();
    const updated = fn(this.read());
    this.write(updated);
    return updated;
  }

  /**
   * Resolves once every write issued so far is durably on disk; rejects if
   * the disk write failed (the cache stays ahead and the next write/flush
   * retries). Synchronous-write stores have nothing pending, so this resolves
   * immediately. The widget flush protocol's persisted=true depends on this:
   * `ShellManager.setInstanceState` awaits it before acking.
   */
  async flush(): Promise<void> {
    while (!this.closed && (this.dirty || this.writeLoop !== null)) {
      await this.ensureDrain();
    }
  }

  invalidate(): void {
    // A pending coalesced write means the cache is ahead of disk; dropping it
    // would make the next read resurrect the stale on-disk value.
    if (this.dirty || this.writeLoop !== null) return;
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

  /** Start (or join) the single in-flight drain. Fire-and-forget `write()`
   * callers never await it, so failures are logged here; `flush()` callers
   * still observe the rejection through the returned promise. */
  private ensureDrain(): Promise<void> {
    if (this.writeLoop) return this.writeLoop;
    const loop = this.drainWrites().finally(() => {
      if (this.writeLoop === loop) this.writeLoop = null;
    });
    this.writeLoop = loop;
    loop.catch((err: unknown) => {
      console.error(`[json-store] ${this.filePath}: coalesced write failed:`, err);
    });
    return loop;
  }

  /** Write the latest cache to disk, looping while writes land mid-flight —
   * single in-flight write, one trailing write, latest cache wins. */
  private async drainWrites(): Promise<void> {
    while (this.dirty && !this.closed) {
      const current = this.cache;
      if (current === undefined) return; // unreachable: dirty implies write() set the cache
      this.dirty = false;
      const payload = JSON.stringify(this.encode(current), null, 2);
      try {
        if (this.fs.writeAsync) {
          await this.fs.writeAsync(this.filePath, payload, {
            mode: this.mode,
            shouldAbort: () => this.closed,
          });
        } else {
          this.fs.write(this.filePath, payload, this.mode);
        }
      } catch (err) {
        this.dirty = true; // disk is behind the cache; the next write/flush retries
        throw err;
      }
    }
  }

  private migrate(parsed: unknown, versioning: StoreVersioning): MigrateOutcome {
    let value = parsed;
    let version = readVersion(value);
    let migrated = false;
    if (version === null) {
      try {
        value = versioning.fromLegacy(value);
      } catch (err) {
        return { kind: "corrupt", reason: `legacy migration failed: ${toErrorMessage(err)}` };
      }
      version = readVersion(value);
      if (version === null) {
        return { kind: "corrupt", reason: "legacy migration produced an unversioned value" };
      }
      migrated = true;
    }
    while (version < versioning.current) {
      const step = versioning.migrations?.[version];
      if (!step) {
        return { kind: "corrupt", reason: `no migration registered from v${version}` };
      }
      try {
        value = step(value);
      } catch (err) {
        return {
          kind: "corrupt",
          reason: `migration from v${version} failed: ${toErrorMessage(err)}`,
        };
      }
      const next = readVersion(value);
      if (next === null || next <= version) {
        return {
          kind: "corrupt",
          reason: `migration from v${version} did not advance the version field`,
        };
      }
      version = next;
      migrated = true;
    }
    if (version > versioning.current) return { kind: "newer-version", fileVersion: version };
    return { kind: "ok", value, migrated };
  }

  private recoverCorrupt(raw: string, reason: string): T {
    const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
    this.backup(raw, backupPath);
    console.error(
      `[json-store] ${this.filePath}: ${reason}; original preserved at ${backupPath}, store reset to defaults`,
    );
    this.cache = structuredClone(this.defaultValue);
    this.surface({ kind: "corrupt", filePath: this.filePath, backupPath, reason });
    return structuredClone(this.cache);
  }

  /**
   * A file written by a NEWER build than this one (electron-updater
   * downgrade/rollback). Not corruption — the data is healthy, we just
   * can't read it. Set it aside under a name that records the version so
   * a later re-upgrade (or the user) can restore it.
   */
  private quarantineNewer(raw: string, fileVersion: number, supportedVersion: number): T {
    const backupPath = `${this.filePath}.newer-v${fileVersion}-${Date.now()}`;
    this.backup(raw, backupPath);
    console.error(
      `[json-store] ${this.filePath}: file version ${fileVersion} is newer than supported ${supportedVersion} (downgraded build?); quarantined to ${backupPath}, store reset to defaults`,
    );
    this.cache = structuredClone(this.defaultValue);
    this.surface({
      kind: "newer-version",
      filePath: this.filePath,
      backupPath,
      fileVersion,
      supportedVersion,
    });
    return structuredClone(this.cache);
  }

  /** Move the bad file aside (preferred), or copy its bytes if the adapter
   * can't rename. Best-effort: if the disk is dead we can't help. */
  private backup(raw: string, backupPath: string): void {
    if (this.fs.rename) {
      try {
        this.fs.rename(this.filePath, backupPath);
        return;
      } catch {
        // Fall back to a copy below.
      }
    }
    try {
      this.fs.write(backupPath, raw, this.mode);
    } catch {
      // Recovery is best-effort; the console.error is the durable record.
    }
  }

  private surface(event: StoreRecoveryEvent): void {
    if (this.onRecovery) {
      this.onRecovery(event);
      return;
    }
    try {
      defaultRecoveryNotifier?.(event);
    } catch {
      // Non-fatal — the console.error in the caller is the durable record.
    }
  }
}
