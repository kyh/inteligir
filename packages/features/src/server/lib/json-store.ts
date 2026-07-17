import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { isRecord, toErrorMessage } from "@repo/features/ipc";

const INTELIGIR_DIR = path.join(os.homedir(), ".inteligir");

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

/** Short stable file-name key for a path-like identifier (vault root,
 * vaultId — both may contain `/`): sha-256 hex, first 16 chars. The shared
 * idiom behind every per-vault file under ~/.inteligir (index DBs, sync base
 * manifests, sync blob dirs). */
export function shortPathKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export type FsAdapter = {
  read: (filePath: string) => string | null;
  write: (filePath: string, content: string, mode?: number) => void;
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

// Write to <path>.tmp then rename — atomic on POSIX + NTFS, so a crash mid-write
// leaves the previous file intact instead of a half-written one. `mode` applies
// to the tmp file, so the rename carries it to the target.
//
// Mode DEFAULTS to owner-only (0o600): every JsonStore lives under
// ~/.inteligir, and several hold credentials or note content (secrets,
// the snapshots index, delegation records naming note lines). A store that
// genuinely needed shared visibility would pass an explicit mode — none does;
// revisit this default before ever pointing a JsonStore outside ~/.inteligir.
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
    const fileMode = mode ?? 0o600;
    fs.writeFileSync(tmp, content, { encoding: "utf8", mode: fileMode });
    // writeFileSync's mode applies only on CREATE — a stale tmp left by a
    // crash would otherwise carry its old (possibly 0644) mode through the
    // rename. An explicit chmod makes the mode unconditional.
    fs.chmodSync(tmp, fileMode);
    fs.renameSync(tmp, filePath);
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
   * POSIX permission bits applied to the file on every write. Defaults to
   * 0o600 (owner-only — every store lives under ~/.inteligir); explicit
   * values at call sites document intent. Backups written on recovery
   * inherit it too.
   */
  mode?: number;
};

/**
 * A `fromLegacy` for stores that never had an unversioned era: any file
 * without an integer `version` field is corrupt by definition. `storeName`
 * names the store in the quarantine reason.
 */
export function rejectLegacyVersion(storeName: string): (raw: unknown) => never {
  return () => {
    throw new Error(`${storeName} store has no version field`);
  };
}

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
  // is a no-op. Logout teardown closes every store before rm -rf'ing
  // `~/.inteligir/`; without it a stale reference held by an in-flight
  // handler could re-create the dir via the `mkdirSync(dirname)` in
  // `realFs.write`, undoing the deletion.
  private closed = false;
  private readonly fs: FsAdapter;
  private readonly onRecovery: ((event: StoreRecoveryEvent) => void) | undefined;
  private readonly decode: (raw: unknown) => T;
  private readonly encode: (value: T) => unknown;
  private readonly versioning: StoreVersioning | undefined;
  private readonly mode: number | undefined;

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
    this.fs.write(this.filePath, JSON.stringify(this.encode(this.cache), null, 2), this.mode);
  }

  /**
   * Write-time validation: a value whose encoded form fails the store's own
   * schema is a programmer bug. Persisting it would be worse than failing —
   * the next read would Value.Check-reject the file and corrupt-recovery
   * would quarantine it, silently wiping the user's state to defaults. Throws
   * before the cache or disk are touched and logs unconditionally so
   * fire-and-forget callers still leave a record.
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
