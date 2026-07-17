// ---------------------------------------------------------------------------
// DelegationSnapshotStore — the pre-run copy behind "Restore original".
//
// The background agent edits vault files with its own file tools through the
// ./vault symlink, so the host can't intercept the write itself. Instead the
// delegation-manager captures the target file's bytes here at delegation START
// (after the checkbox is re-resolved, before the agent is dispatched) — a
// cheap, restorable undo point without a full history feature.
//
// Layout under ~/.inteligir: content bytes live as one file per delegation id
// in `snapshots/` (bytes don't belong inside a JSON blob), and a small
// versioned JsonStore index (`snapshots.json`) maps delegation id →
// {path, snapshotFile, capturedAt, hash}. The bytes file is written before the
// index entry, so a crash between the two leaves only an orphan file — swept
// by prune() — never an index entry whose bytes are missing.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { JsonStore, inteligirPath, type FsAdapter } from "../lib/json-store";

// Retention: keep the newest 50 snapshots, pruned on host start. A count cap
// (not an age window) keeps disk usage proportional to actual delegation use —
// snapshots are whole-file copies, so "50 × typical note size" is a bounded,
// predictable footprint, while an idle vault never loses its recent undo
// points to a calendar. 50 comfortably outlasts the delegation dock's recall
// horizon (delegation records themselves cap at 200 and snapshots are only
// actionable while their record survives), and this is a cheap-undo feature,
// not history — usefulness decays fast once the user has edited on top.
export const SNAPSHOT_RETENTION = 50;

const SNAPSHOTS_VERSION = 1;

const SnapshotEntrySchema = Type.Object(
  {
    delegationId: Type.String(),
    /** Vault-relative path of the target file AT CAPTURE TIME. Diagnostic —
     * restore targets the delegation record's current sourceFile, which the
     * manager remaps across renames. */
    path: Type.String(),
    /** Bytes file name under the snapshots dir (relative, so ~/.inteligir can
     * move without breaking the index). */
    snapshotFile: Type.String(),
    capturedAt: Type.Number(),
    /** sha256 hex of the snapshot bytes — integrity check at read time so a
     * torn/tampered bytes file can never be written back into the vault. */
    hash: Type.String(),
  },
  { additionalProperties: false },
);

type SnapshotEntry = Static<typeof SnapshotEntrySchema>;

const SnapshotsFileSchema = Type.Object(
  { version: Type.Literal(SNAPSHOTS_VERSION), snapshots: Type.Array(SnapshotEntrySchema) },
  { additionalProperties: false },
);

/** The few content-file operations the store needs, injectable for tests.
 * Kept separate from FsAdapter (which is JSON-store-shaped): pruning needs
 * remove + directory listing, which no JsonStore ever needs. */
export type SnapshotFileAdapter = {
  read: (filePath: string) => string | null;
  write: (filePath: string, content: string) => void;
  remove: (filePath: string) => void;
  /** File names directly inside `dir`; [] when the dir doesn't exist. */
  list: (dir: string) => string[];
};

// Content files get the same tmp+rename atomic write as everything else under
// ~/.inteligir — a crash mid-write must not leave a half snapshot that the
// hash check would then reject at restore time. Written 0o600: snapshot bytes
// are raw NOTE CONTENT (the dir is already 0700; defense in depth).
const realFiles: SnapshotFileAdapter = {
  read: (filePath) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
  write: (filePath, content) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
    // Mode applies only on create — heal a stale crash-leftover tmp too.
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, filePath);
  },
  remove: (filePath) => {
    fs.rmSync(filePath, { force: true });
  },
  list: (dir) => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  },
};

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export type SnapshotReadResult =
  | { ok: true; path: string; content: string }
  | { ok: false; error: string };

export type DelegationSnapshotStoreOptions = {
  /** JsonStore adapter for the index (tests). */
  fs?: FsAdapter;
  /** Content-file adapter (tests). */
  files?: SnapshotFileAdapter;
  /** Content directory. Defaults to ~/.inteligir/snapshots. */
  dir?: string;
  /** Index path. Defaults to ~/.inteligir/snapshots.json — a SIBLING of the
   * content dir, so prune's orphan sweep can treat every file in the dir as a
   * snapshot without special-casing the index (or its .tmp/.corrupt kin). */
  indexPath?: string;
};

export class DelegationSnapshotStore {
  private readonly index: JsonStore<SnapshotEntry[]>;
  private readonly files: SnapshotFileAdapter;
  private readonly dir: string;

  constructor(opts: DelegationSnapshotStoreOptions = {}) {
    this.files = opts.files ?? realFiles;
    this.dir = opts.dir ?? inteligirPath("snapshots");
    this.index = new JsonStore<SnapshotEntry[]>(
      opts.indexPath ?? inteligirPath("snapshots.json"),
      SnapshotsFileSchema,
      [],
      {
        fs: opts.fs,
        versioning: {
          current: SNAPSHOTS_VERSION,
          // No unversioned era — snapshots.json is new with this store.
          fromLegacy: () => {
            throw new Error("snapshots.json has no version field");
          },
        },
        decode: (raw) => {
          if (!Value.Check(SnapshotsFileSchema, raw)) throw new Error("snapshots shape rejected");
          return raw.snapshots;
        },
        encode: (snapshots) => ({ version: SNAPSHOTS_VERSION, snapshots }),
      },
    );
  }

  /** Persist `content` as delegation `delegationId`'s pre-run copy of `path`.
   * Throws on any failure — the caller must treat an uncaptured snapshot as
   * fatal to the run (an agent edit with no undo point must never happen).
   * Re-capturing the same id overwrites (each delegation runs at most once, so
   * this only makes the operation idempotent). */
  capture(delegationId: string, filePath: string, content: string): void {
    const snapshotFile = delegationId;
    // Bytes first, index second — see the crash-ordering note in the header.
    this.files.write(path.join(this.dir, snapshotFile), content);
    const entry: SnapshotEntry = {
      delegationId,
      path: filePath,
      snapshotFile,
      capturedAt: Date.now(),
      hash: sha256(content),
    };
    this.index.update((all) => [...all.filter((e) => e.delegationId !== delegationId), entry]);
  }

  /** Read a snapshot's bytes, verifying them against the recorded hash so a
   * torn or tampered content file is surfaced instead of restored. */
  read(delegationId: string): SnapshotReadResult {
    const entry = this.index.read().find((e) => e.delegationId === delegationId);
    if (!entry) return { ok: false, error: "No snapshot exists for this delegation." };
    const content = this.files.read(path.join(this.dir, entry.snapshotFile));
    if (content === null) return { ok: false, error: "The snapshot file is missing." };
    if (sha256(content) !== entry.hash) {
      return { ok: false, error: "The snapshot file is corrupt and can't be restored." };
    }
    return { ok: true, path: entry.path, content };
  }

  /** Retention sweep, run on host start: keep the newest SNAPSHOT_RETENTION
   * entries, delete the bytes of everything older, and remove orphan files in
   * the content dir that no surviving entry references (crash leftovers).
   * Best-effort on the file operations — the index is the source of truth. */
  prune(): string[] {
    const all = this.index.read();
    const byNewest = all.toSorted((a, b) => b.capturedAt - a.capturedAt);
    const kept = byNewest.slice(0, SNAPSHOT_RETENTION);
    if (kept.length !== all.length) {
      this.index.write(kept);
    }
    const prunedIds = byNewest.slice(SNAPSHOT_RETENTION).map((e) => e.delegationId);
    const referenced = new Set(kept.map((e) => e.snapshotFile));
    for (const name of this.files.list(this.dir)) {
      if (referenced.has(name)) continue;
      try {
        this.files.remove(path.join(this.dir, name));
      } catch (err) {
        console.warn(`[snapshots] could not remove ${name}:`, err);
      }
    }
    return prunedIds;
  }
}
