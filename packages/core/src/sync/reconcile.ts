import type { LocalFile, LocalManifest, VaultManifest } from "./manifest";
import type { SyncOp, SyncPlan, SyncSide } from "./plan";
import { ABSENT_VERSION, type VaultFile, type VaultPath } from "./vault-file";

// ---------------------------------------------------------------------------
// reconcile — the last-write-wins + conflict-copy brain.
//
// A PURE 3-way merge of one vault: the last-synced `base`, the device's current
// `local` state, and the coordinator's current `remote` state. It returns a
// `SyncPlan` of typed ops and does NO I/O, reads NO clock, and computes NO
// hashes (all supplied by the caller). Apply the plan with a `SyncPort` + local
// vault access elsewhere.
//
// Out of scope by design: the knowledge index (link graph, backlinks, lexical
// search) and all AI/editor state are DERIVED, rebuilt per device, and never
// appear in a manifest — the protocol carries vault files only.
//
// TIEBREAK (the LWW rule, documented): when both sides changed a file since
// `base`, the newer side wins the canonical path and the older is saved as a
// conflict copy. "Newer" is decided by, in order:
//   1. VERSION — higher coordinator version wins. The local side's version is
//      the `base` (last-synced) version of that path; to reach a conflict the
//      remote must have advanced PAST base, so under a correct monotonic
//      coordinator REMOTE wins and the local edit becomes the conflict copy.
//   2. CONTENT HASH — a deterministic, argument-order-independent fallback for
//      the (coordinator-invariant-violating) case of equal versions with
//      differing content: the lexicographically greater hash wins.
// Wall-clock time is never consulted (`Date.now()` isn't available here); the
// ISO timestamp that NAMES a conflict copy is passed into `conflictCopyName` by
// the executor, keeping `reconcile` deterministic and pure.
// ---------------------------------------------------------------------------

export function reconcile(
  base: VaultManifest,
  local: LocalManifest,
  remote: VaultManifest,
): SyncPlan {
  const baseByPath = byPath(base.files);
  const localByPath = byPath(local.files);
  const remoteByPath = byPath(remote.files);

  const ops: SyncOp[] = [];

  for (const path of sortedUnion(baseByPath, localByPath, remoteByPath)) {
    const b = baseByPath.get(path);
    const l = localByPath.get(path);
    const r = remoteByPath.get(path);

    const localChanged = b?.contentHash !== l?.contentHash;
    const remoteChanged = b?.contentHash !== r?.contentHash;

    // 1. Nothing changed on either side since base — already converged.
    if (!localChanged && !remoteChanged) continue;

    // 2. One-sided local change.
    if (localChanged && !remoteChanged) {
      if (l) {
        // created or edited locally -> push to the coordinator
        ops.push({
          kind: "push",
          path,
          expectedBaseVersion: r?.version ?? ABSENT_VERSION,
          baseHash: b?.contentHash ?? null,
        });
      } else if (r) {
        // deleted locally, coordinator unchanged -> delete on the coordinator
        ops.push({ kind: "delete", side: "remote", path, expectedBaseVersion: r.version });
      }
      continue;
    }

    // 3. One-sided remote change.
    if (!localChanged && remoteChanged) {
      if (r) {
        // created or edited on the coordinator -> pull to local
        ops.push({ kind: "pull", file: r });
      } else {
        // deleted on the coordinator, local unchanged -> delete locally
        ops.push({ kind: "delete", side: "local", path });
      }
      continue;
    }

    // 4. Both sides changed since base.
    if (l && r) {
      // both present and edited
      if (l.contentHash === r.contentHash) continue; // coincidentally identical -> converged
      // true conflict -> LWW: winner keeps `path`, loser becomes a conflict copy
      ops.push({
        kind: "conflict-copy",
        path,
        winner: pickWinner(b?.version ?? ABSENT_VERSION, l, r),
        local: l,
        remote: r,
        baseHash: b?.contentHash ?? null,
      });
      continue;
    }
    if (l) {
      // local edit vs remote delete -> resurrect: keep the edit, recreate remote
      // (never silently lose an edit)
      ops.push({
        kind: "push",
        path,
        expectedBaseVersion: ABSENT_VERSION,
        baseHash: b?.contentHash ?? null,
      });
      continue;
    }
    if (r) {
      // local delete vs remote edit -> keep the remote edit, pull it back
      ops.push({ kind: "pull", file: r });
      continue;
    }
    // else: both deleted -> converged on absence, nothing to do
  }

  return { ops };
}

/**
 * The LWW tiebreak (see the module header). `localVersion` is the base
 * (last-synced) version the local side sits at.
 */
function pickWinner(localVersion: number, local: LocalFile, remote: VaultFile): SyncSide {
  if (remote.version > localVersion) return "remote";
  if (localVersion > remote.version) return "local";
  // Equal versions with differing content is a coordinator-invariant violation;
  // resolve it deterministically (order-independent) by content hash so every
  // peer reaches the same winner.
  return remote.contentHash > local.contentHash ? "remote" : "local";
}

/**
 * Format a Date as the filesystem-safe ISO timestamp `conflictCopyName`
 * expects (`2026-07-05T12-34-56-000Z` — `:` and `.` swapped for `-`; Windows/
 * exFAT reject `:`). PURE: the Date comes from the caller's platform clock —
 * @repo/core never reads time. One implementation for every platform's Clock
 * adapter (desktop node, mobile Expo).
 */
export function fsSafeStamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
}

/**
 * The sibling filename that preserves the losing side of a conflict, e.g.
 * `conflictCopyName("notes/todo.md", "2026-07-05T12-34-56Z")` →
 * `"notes/todo (conflict 2026-07-05T12-34-56Z).md"`. Keeps the file in the same
 * directory with the same extension so it stays a sibling in the vault.
 *
 * PURE: the timestamp is supplied by the caller (the executor passes an ISO
 * string from its platform clock) — @repo/core never reads time. Pass a
 * filesystem-safe timestamp (`fsSafeStamp`).
 */
export function conflictCopyName(path: VaultPath, isoTimestamp: string): VaultPath {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash + 1);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0; // a dot at index 0 is a dotfile, not an extension
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  return `${dir}${stem} (conflict ${isoTimestamp})${ext}`;
}

/** The exact stamp shape `fsSafeStamp` emits (`2026-07-05T12-34-56-000Z`) — an
 * ISO-8601 UTC instant with `:`/`.` swapped for `-`. Anchored so a user file
 * that merely contains "(conflict …)" never matches. */
const CONFLICT_STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/**
 * The reverse of `conflictCopyName`: does `path` name a conflict copy this
 * engine could have produced? Core owns the naming BOTH ways so UIs (listing
 * unresolved conflicts) and the naming scheme can never drift apart. Matches
 * exactly the `conflictCopyName(path, fsSafeStamp(date))` shape — a
 * ` (conflict <fs-safe stamp>)` suffix on the stem — and nothing looser.
 */
export function isConflictCopyPath(path: string): boolean {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0; // mirror conflictCopyName: a leading dot is a dotfile
  const stem = hasExt ? name.slice(0, dot) : name;
  const marker = stem.lastIndexOf(" (conflict ");
  if (marker === -1 || !stem.endsWith(")")) return false;
  const stamp = stem.slice(marker + " (conflict ".length, -1);
  return CONFLICT_STAMP_RE.test(stamp);
}

// ---- internals ------------------------------------------------------------

function byPath<T extends { readonly path: VaultPath }>(files: readonly T[]): Map<VaultPath, T> {
  const map = new Map<VaultPath, T>();
  for (const file of files) map.set(file.path, file);
  return map;
}

function sortedUnion(...maps: readonly ReadonlyMap<VaultPath, unknown>[]): VaultPath[] {
  const paths = new Set<VaultPath>();
  for (const map of maps) {
    for (const path of map.keys()) paths.add(path);
  }
  return [...paths].toSorted();
}
