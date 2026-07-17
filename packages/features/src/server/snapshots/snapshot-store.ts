// ---------------------------------------------------------------------------
// SnapshotStore — pre-write copies of vault notes behind every AI-edit undo.
//
// The agents edit vault files with their own file tools through the ./vault
// symlink, so the host can't rely on owning the write itself. Instead a copy
// of the target file's bytes is captured here BEFORE the AI writes, keyed by
// origin:
//   - "delegation": the delegation-manager captures the target file at run
//     START (id = the delegation id); the dock's "Restore original" reads it
//     back by that id.
//   - "chat": the checkpoint seam behind the privacy tool gate captures per
//     allowed edit/write, pre-execution (checkpoints/checkpoint-manager.ts);
//     the post-turn undo toast restores by id.
// A cheap, restorable undo point without a full history feature.
//
// Layout under ~/.inteligir: content bytes live as one file per snapshot id
// in `snapshots/` (bytes don't belong inside a JSON blob), and a small
// versioned JsonStore index (`snapshots.json`) maps id →
// {origin, path, kind, snapshotFile, capturedAt, hash}. The bytes file is
// written before the index entry, so a crash between the two leaves only an
// orphan file — swept by prune() — never an index entry whose bytes are
// missing.
//
// ONE process-wide instance (getSnapshotStore): the JsonStore index caches in
// memory, so a second instance over the same file would lose updates.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { JsonStore, inteligirPath, rejectLegacyVersion, type FsAdapter } from "../lib/json-store";
import { isRecord } from "@repo/features/ipc";

// Retention: keep the newest 50 snapshots PER ORIGIN, pruned on host start.
// A count cap (not an age window) keeps disk usage proportional to actual AI
// use — snapshots are whole-file copies, so "50 × typical note size" is a
// bounded, predictable footprint, while an idle vault never loses its recent
// undo points to a calendar. Per origin, so a chatty agent session can never
// evict delegation undo points (or vice versa). 50 comfortably outlasts each
// surface's recall horizon (delegation records cap at 200 and snapshots are
// only actionable while their record survives; the chat undo toast is
// transient), and this is a cheap-undo feature, not history — usefulness
// decays fast once the user has edited on top.
export const SNAPSHOT_RETENTION = 50;

const SNAPSHOTS_VERSION = 2;

/** Which AI surface captured the snapshot. Delegation ids double as the
 * delegation record's id (the manager reads by it); chat ids are opaque. */
export type SnapshotOrigin = "delegation" | "chat";

/** What the pre-write state was. `edit` = the file existed and `content` is
 * its exact prior bytes; `create` = the file did NOT exist (a new-file
 * `write`), so undo means deleting it — the stored content is empty. */
export type SnapshotKind = "edit" | "create";

const SnapshotEntrySchema = Type.Object(
  {
    /** Unique snapshot id. For origin "delegation" this IS the delegation id
     * (the manager's read-by-id contract, unchanged from v1). */
    id: Type.String(),
    origin: Type.Union([Type.Literal("delegation"), Type.Literal("chat")]),
    /** Vault-relative path of the target file AT CAPTURE TIME, remapped across
     * renames (renamePath). For chat snapshots this is the restore target;
     * delegation restore targets the delegation record's current sourceFile,
     * so there it stays diagnostic. */
    path: Type.String(),
    kind: Type.Union([Type.Literal("edit"), Type.Literal("create")]),
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

/** Repoint a vault-relative path across a rename/move. Handles an exact file
 * rename and a folder rename (every path under `from/`). Uses `/` — vault
 * paths are POSIX-relative regardless of host OS. Shared with the delegation
 * manager's record remap so the two views can't diverge. */
export function remapVaultPath(rel: string, from: string, to: string): string {
  if (rel === from) return to;
  if (rel.startsWith(`${from}/`)) return `${to}${rel.slice(from.length)}`;
  return rel;
}

/** Everything but the store-owned fields (snapshotFile, capturedAt, hash). */
export type SnapshotMeta = {
  id: string;
  origin: SnapshotOrigin;
  path: string;
  kind: SnapshotKind;
};

export type SnapshotReadResult =
  | { ok: true; origin: SnapshotOrigin; path: string; kind: SnapshotKind; content: string }
  | { ok: false; error: string };

export type SnapshotStoreOptions = {
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

export class SnapshotStore {
  private readonly index: JsonStore<SnapshotEntry[]>;
  private readonly files: SnapshotFileAdapter;
  private readonly dir: string;

  constructor(opts: SnapshotStoreOptions = {}) {
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
          // No unversioned era — snapshots.json was born versioned.
          fromLegacy: rejectLegacyVersion("snapshots.json"),
          migrations: {
            // v1 → v2: delegation-only entries generalized to AI-write
            // snapshots. Every v1 entry was captured by a delegation before
            // it ran against an existing file: id = the old delegationId,
            // origin "delegation", kind "edit".
            1: (raw) => {
              if (!isRecord(raw) || !Array.isArray(raw["snapshots"])) {
                throw new Error("v1 snapshots shape rejected");
              }
              return {
                version: SNAPSHOTS_VERSION,
                snapshots: raw["snapshots"].map((entry: unknown) => {
                  if (!isRecord(entry) || typeof entry["delegationId"] !== "string") {
                    throw new Error("v1 snapshot entry rejected");
                  }
                  const { delegationId, ...rest } = entry;
                  return { ...rest, id: delegationId, origin: "delegation", kind: "edit" };
                }),
              };
            },
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

  /** Persist `content` as snapshot `meta.id`'s pre-write copy of `meta.path`.
   * Throws on any failure — callers must treat an uncaptured snapshot as
   * fatal to the write (an AI edit with no undo point must never happen).
   * Re-capturing the same id overwrites (a delegation runs at most once, so
   * this only makes the operation idempotent; chat ids are fresh per call). */
  capture(meta: SnapshotMeta, content: string): void {
    const snapshotFile = meta.id;
    // Bytes first, index second — see the crash-ordering note in the header.
    this.files.write(path.join(this.dir, snapshotFile), content);
    const entry: SnapshotEntry = {
      ...meta,
      snapshotFile,
      capturedAt: Date.now(),
      hash: sha256(content),
    };
    this.index.update((all) => [...all.filter((e) => e.id !== meta.id), entry]);
  }

  /** Read a snapshot's bytes, verifying them against the recorded hash so a
   * torn or tampered content file is surfaced instead of restored. */
  read(id: string): SnapshotReadResult {
    const entry = this.index.read().find((e) => e.id === id);
    if (!entry) return { ok: false, error: "No saved copy exists for this edit." };
    const content = this.files.read(path.join(this.dir, entry.snapshotFile));
    if (content === null) return { ok: false, error: "The saved copy is missing." };
    if (sha256(content) !== entry.hash) {
      return { ok: false, error: "The saved copy is corrupt and can't be restored." };
    }
    return { ok: true, origin: entry.origin, path: entry.path, kind: entry.kind, content };
  }

  /** A vault file/folder was renamed/moved — repoint entry paths so a chat
   * restore targets the moved file (delegation restore targets the delegation
   * record's sourceFile, remapped by the manager; its entry path is remapped
   * here too so the two views never contradict). */
  renamePath(from: string, to: string): void {
    if (this.index.read().every((e) => remapVaultPath(e.path, from, to) === e.path)) return;
    this.index.update((all) =>
      all.map((e) => {
        const next = remapVaultPath(e.path, from, to);
        return next === e.path ? e : { ...e, path: next };
      }),
    );
  }

  /** Retention sweep, run on host start: keep the newest SNAPSHOT_RETENTION
   * entries PER ORIGIN, delete the bytes of everything older, and remove
   * orphan files in the content dir that no surviving entry references (crash
   * leftovers). Best-effort on the file operations — the index is the source
   * of truth. Returns the pruned ids (all origins) so callers can clear any
   * restore affordance whose bytes are gone. */
  prune(): string[] {
    const all = this.index.read();
    const keptIds = new Set<string>();
    for (const origin of ["delegation", "chat"] as const) {
      const byNewest = all
        .filter((e) => e.origin === origin)
        .toSorted((a, b) => b.capturedAt - a.capturedAt);
      for (const e of byNewest.slice(0, SNAPSHOT_RETENTION)) keptIds.add(e.id);
    }
    const kept = all.filter((e) => keptIds.has(e.id));
    if (kept.length !== all.length) {
      this.index.write(kept);
    }
    const prunedIds = all.filter((e) => !keptIds.has(e.id)).map((e) => e.id);
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

// ---------------------------------------------------------------------------
// Lazy singleton — the index JsonStore caches in memory, so the delegation
// manager and the checkpoint manager MUST share one instance (two would lose
// each other's writes). Mirrors the vault/delegation managers; reset on
// logout teardown so a warm cache can't resurrect the wiped file.
// ---------------------------------------------------------------------------

let instance: SnapshotStore | null = null;

export function getSnapshotStore(): SnapshotStore {
  if (!instance) instance = new SnapshotStore();
  return instance;
}

export function resetSnapshotStore(): void {
  instance = null;
}
