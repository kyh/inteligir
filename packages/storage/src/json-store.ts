import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { atomicWrite } from "./atomic-write";
import { isRecord, toErrorMessage } from "./fs-errors";

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
   * stop being re-detected on every launch. If it throws, backup falls back
   * to copy-on-write (backup written, original left in place).
   */
  rename: (from: string, to: string) => void;
};

// ~/.inteligir holds credentials (pi's auth.json, secrets.json) — keep the
// directory itself owner-only. New dirs are created 0o700 by the mkdir calls
// below; this heals an existing dir that was created with looser permissions.
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

// Writes go through the shared tmp-then-rename atomicWrite (storage/atomic-write).
//
// Mode is fixed owner-only (0o600): every JsonStore lives under
// ~/.inteligir, and several hold credentials or note content (secrets,
// the snapshots index, delegation records naming note lines). Revisit
// before ever pointing a JsonStore outside ~/.inteligir.
//
// Exported so other ~/.inteligir JSON writers (e.g. @repo/sync's base-manifest
// store) inherit the same atomic-write + owner-only guarantees instead of
// hand-rolling a weaker fs branch.
export const realFs: FsAdapter = {
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
    atomicWrite(filePath, content, { mode: mode ?? 0o600 });
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
 * On-disk format version. Every new store MUST provide this. Version drift is
 * quarantine-only until a real migration ships: a file at any version other
 * than `current` (newer, older, or unversioned) is set aside and the store
 * resets to defaults — no migration registry exists. Only pre-existing stores
 * whose contents are documented as ephemeral (ui-state.json) may omit it.
 */
export type StoreVersioning = {
  /** Version the current schema describes. */
  current: number;
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
  /** On-disk format version. Required for new stores. */
  versioning?: StoreVersioning;
};

function readVersion(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const version = value["version"];
  return typeof version === "number" && Number.isInteger(version) ? version : null;
}

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

  constructor(
    private readonly filePath: string,
    private readonly schema: TSchema,
    private readonly defaultValue: T,
    options: JsonStoreOptions<T> = {},
  ) {
    this.fs = options.fs ?? realFs;
    this.onRecovery = options.onRecovery;
    // `raw as T`: the schema↔generic seam. `raw` was already Value.Check'd
    // against `schema`, but `schema: TSchema` erases its Static type, so the
    // compiler can't connect it to T. Callers omitting `decode` assert
    // Static<schema> is T.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- schema↔generic seam, see doc above
    this.decode = options.decode ?? ((raw) => raw as T);
    this.encode = options.encode ?? ((value) => value);
    this.versioning = options.versioning;
  }

  /**
   * Read + validate. Returns the defaultValue if the file is missing. A file
   * whose version is newer than `versioning.current` (downgraded build) is
   * quarantined to <path>.newer-v<N>-<ts>; an unrecoverable file
   * (unparseable / wrong version / schema-rejected) is moved aside to
   * <path>.corrupt-<ts>. Both paths log, keep the original bytes at the
   * backup path, and surface a recovery event.
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
    if (this.versioning) {
      const version = readVersion(parsed);
      if (version === null) return this.recoverCorrupt(raw, "no version field");
      if (version > this.versioning.current) {
        return this.quarantineNewer(raw, version, this.versioning.current);
      }
      if (version < this.versioning.current) {
        return this.recoverCorrupt(raw, `unsupported version v${version}`);
      }
    }
    if (!Value.Check(this.schema, parsed)) {
      return this.recoverCorrupt(raw, "schema validation failed");
    }
    try {
      this.cache = this.decode(parsed);
    } catch (err) {
      return this.recoverCorrupt(raw, `decode failed: ${toErrorMessage(err)}`);
    }
    return structuredClone(this.cache);
  }

  write(data: T): void {
    if (this.closed) return;
    this.assertWritable(data);
    this.cache = structuredClone(data);
    this.fs.write(this.filePath, JSON.stringify(this.encode(this.cache), null, 2), 0o600);
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

  /** Move the bad file aside (preferred), or copy its bytes if the rename
   * throws. Best-effort: if the disk is dead we can't help. */
  private backup(raw: string, backupPath: string): void {
    try {
      this.fs.rename(this.filePath, backupPath);
      return;
    } catch {
      // Fall back to a copy below.
    }
    try {
      this.fs.write(backupPath, raw, 0o600);
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
