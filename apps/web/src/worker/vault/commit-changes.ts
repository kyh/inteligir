import { vaultCollisionKey } from "@repo/api/cloud/vault/vault-commit-schema";
import type { VaultConflictReason } from "@repo/api/cloud/vault/vault-commit-schema";
import { VAULT_FILE_MAX_BYTES } from "@repo/api/cloud/vault/vault-schema";
import type { RepoCell, TreeEntryJson, TreeResult } from "durable-git";
import {
  blobObject,
  commitObject,
  FILE_MODE,
  gitIdent,
  gitObject,
  serializeTree,
  TREE_MODE,
  treeObject,
  writePack,
} from "./git-objects";
import type { GitObject, GitTreeEntry } from "./git-objects";
import type { VaultPackPush, VaultPushOutcome } from "./receive-pack";
import { encodeGitPath, isServablePath } from "./tree-walk";

// A change set lands as one commit on the head it was checked against, or not at all. Each change
// carries the blob it was computed from (null: the path was absent), so the cell's head is a CAS
// per path; a change whose target the head already holds is satisfied, which is what makes a
// resent set harmless without an idempotency key.

export type VaultChange =
  | {
      readonly op: "put";
      readonly path: string;
      readonly base: string | null;
      readonly bytes: Uint8Array;
    }
  | { readonly op: "delete"; readonly path: string; readonly base: string }
  | { readonly op: "move"; readonly from: string; readonly to: string; readonly base: string };

export interface VaultConflict {
  readonly path: string;
  readonly reason: VaultConflictReason;
  // what the path holds at the head the set was checked against; its text rides along only for a
  // note that fits
  readonly current: { readonly oid: string; readonly content?: string } | null;
  // the committer of the newest commit touching the path: the device this one collided with
  readonly device: string | null;
}

// where each change leaves its path: the blob it holds, or null once it is gone
interface VaultChangeResult {
  readonly path: string;
  readonly oid: string | null;
}

export type CommitChangesResult =
  | {
      readonly kind: "committed";
      readonly commit: string;
      readonly results: readonly VaultChangeResult[];
    }
  | {
      readonly kind: "conflict";
      readonly head: string;
      readonly conflicts: readonly VaultConflict[];
    }
  | { readonly kind: "no-head" }
  | { readonly kind: "full" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "exhausted" };

export interface CommitChangesArgs {
  readonly stub: DurableObjectStub<RepoCell>;
  readonly send: (push: VaultPackPush) => Promise<VaultPushOutcome>;
  readonly changes: readonly VaultChange[];
  readonly author: { readonly deviceId: string; readonly deviceName: string };
  // unix ms: when the device made the change, and when the Worker commits it
  readonly authoredAt: number;
  readonly now: number;
}

// a head that moves under three attempts in one request is a device pushing in a loop; the phone's
// queue sends the set again later
const MAX_ATTEMPTS = 3;

// a conflict answers whole notes so the phone merges in one pass; past this it reads the rest at
// the conflict's head
const CONFLICT_INLINE_BYTES = 8 * 1024 * 1024;

// the committer's email marks a commit the Worker made, while both names stay the device's,
// because a conflict copy names the other device from the committer
const WORKER_COMMITTER_EMAIL = "cloud@inteligir.local";

const deviceEmail = (deviceId: string): string => `device-${deviceId}@inteligir.local`;

const SYMLINK_MODE = "120000";

const encoder = new TextEncoder();

type PreparedChange =
  | {
      readonly op: "put";
      readonly path: string;
      readonly base: string | null;
      readonly blob: GitObject;
    }
  | Exclude<VaultChange, { readonly op: "put" }>;

const prepare = async (change: VaultChange): Promise<PreparedChange> =>
  change.op === "put"
    ? { base: change.base, blob: await blobObject(change.bytes), op: "put", path: change.path }
    : change;

const pathsOf = (change: VaultChange | PreparedChange): readonly string[] =>
  change.op === "move" ? [change.from, change.to] : [change.path];

const resultOf = (change: PreparedChange): VaultChangeResult => {
  switch (change.op) {
    case "put": {
      return { oid: change.blob.oid, path: change.path };
    }
    case "delete": {
      return { oid: null, path: change.path };
    }
    case "move": {
      return { oid: change.base, path: change.to };
    }
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
};

interface Head {
  readonly ref: string;
  // what the ref holds, which the push's CAS names
  readonly target: string;
  readonly commit: string;
}

const readHead = async (stub: DurableObjectStub<RepoCell>): Promise<Head | null> => {
  const { head, refs } = await stub.listRefs();
  const target = refs.find((ref) => ref.name === head)?.target;
  if (head === null || target === undefined) {
    return null;
  }
  const commit = await stub.readCommit(target);
  return commit === null ? null : { commit: commit.oid, ref: head, target };
};

const parentOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
};

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const joinPath = (folder: string, name: string): string =>
  folder === "" ? name : `${folder}/${name}`;

// every folder from the root down to the one holding the path
const foldersAbove = (path: string): string[] => {
  const segments = path.split("/");
  return segments.map((_, depth) => segments.slice(0, depth).join("/"));
};

// the head's folders a set reaches, each listed once; null for one the head does not hold
type Listings = ReadonlyMap<string, TreeResult | null>;

const listFolders = async (
  stub: DurableObjectStub<RepoCell>,
  commit: string,
  changes: readonly PreparedChange[],
): Promise<Listings> => {
  const folders = new Set(changes.flatMap(pathsOf).filter(isServablePath).flatMap(foldersAbove));
  return new Map(
    await Promise.all(
      [...folders].map(async (folder): Promise<readonly [string, TreeResult | null]> => [
        folder,
        await stub.listTree(commit, encodeGitPath(folder)),
      ]),
    ),
  );
};

type Located =
  | { readonly kind: "absent" }
  | { readonly kind: "under-file" }
  | { readonly kind: "entry"; readonly entry: TreeEntryJson };

const locate = (listings: Listings, path: string): Located => {
  const segments = path.split("/");
  let folder = "";
  for (const [depth, name] of segments.entries()) {
    const entry = listings.get(folder)?.entries.find((row) => row.name === name);
    if (entry === undefined) {
      return { kind: "absent" };
    }
    if (depth === segments.length - 1) {
      return { entry, kind: "entry" };
    }
    if (entry.type !== "tree") {
      return { kind: "under-file" };
    }
    folder = joinPath(folder, name);
  }
  return { kind: "absent" };
};

const entryAt = (listings: Listings, path: string): TreeEntryJson | null => {
  const located = locate(listings, path);
  return located.kind === "entry" ? located.entry : null;
};

// a symlink's or a submodule's target is not a note's bytes, so no change writes one
const isRegularFile = (entry: TreeEntryJson): boolean =>
  entry.type === "blob" && entry.mode !== SYMLINK_MODE;

interface LeafEdit {
  readonly path: string;
  // null removes the entry
  readonly entry: { readonly mode: string; readonly oid: string } | null;
}

interface PendingConflict {
  readonly path: string;
  readonly reason: VaultConflictReason;
  readonly entry: TreeEntryJson | null;
}

type Verdict =
  | { readonly kind: "satisfied" }
  | { readonly kind: "applicable"; readonly edits: readonly LeafEdit[] }
  | { readonly kind: "conflict"; readonly conflict: PendingConflict };

const conflictOn = (
  path: string,
  reason: VaultConflictReason,
  entry: TreeEntryJson | null = null,
): Verdict => ({ conflict: { entry, path, reason }, kind: "conflict" });

const classifyPut = (
  listings: Listings,
  { base, blob, path }: Extract<PreparedChange, { readonly op: "put" }>,
): Verdict => {
  const located = locate(listings, path);
  if (located.kind === "under-file") {
    return conflictOn(path, "blocked");
  }
  if (located.kind === "absent") {
    return base === null
      ? { edits: [{ entry: { mode: FILE_MODE, oid: blob.oid }, path }], kind: "applicable" }
      : conflictOn(path, "missing");
  }
  const { entry } = located;
  if (entry.type === "tree") {
    return conflictOn(path, "blocked", entry);
  }
  if (!isRegularFile(entry)) {
    return conflictOn(path, "unwritable", entry);
  }
  if (entry.oid === blob.oid) {
    return { kind: "satisfied" };
  }
  if (entry.oid === base) {
    return { edits: [{ entry: { mode: entry.mode, oid: blob.oid }, path }], kind: "applicable" };
  }
  return conflictOn(path, base === null ? "exists" : "changed", entry);
};

const classifyDelete = (listings: Listings, path: string, base: string): Verdict => {
  const located = locate(listings, path);
  if (located.kind !== "entry") {
    return { kind: "satisfied" };
  }
  const { entry } = located;
  if (entry.type === "tree") {
    return conflictOn(path, "blocked", entry);
  }
  if (!isRegularFile(entry)) {
    return conflictOn(path, "unwritable", entry);
  }
  return entry.oid === base
    ? { edits: [{ entry: null, path }], kind: "applicable" }
    : conflictOn(path, "changed", entry);
};

const classifyMove = (listings: Listings, from: string, to: string, base: string): Verdict => {
  const source = locate(listings, from);
  const destination = locate(listings, to);
  if (source.kind !== "entry") {
    const landed = destination.kind === "entry" ? destination.entry : null;
    return landed !== null && isRegularFile(landed) && landed.oid === base
      ? { kind: "satisfied" }
      : conflictOn(from, "missing");
  }
  const moving = source.entry;
  if (moving.type === "tree") {
    return conflictOn(from, "blocked", moving);
  }
  if (!isRegularFile(moving)) {
    return conflictOn(from, "unwritable", moving);
  }
  if (moving.oid !== base) {
    return conflictOn(from, "changed", moving);
  }
  if (destination.kind === "under-file") {
    return conflictOn(to, "blocked");
  }
  if (destination.kind === "entry") {
    const taken = destination.entry;
    return conflictOn(to, taken.type === "tree" ? "blocked" : "exists", taken);
  }
  return {
    edits: [
      { entry: null, path: from },
      { entry: { mode: moving.mode, oid: base }, path: to },
    ],
    kind: "applicable",
  };
};

const classify = (listings: Listings, change: PreparedChange): Verdict => {
  const unservable = pathsOf(change).find((path) => !isServablePath(path));
  if (unservable !== undefined) {
    return conflictOn(unservable, "unwritable");
  }
  switch (change.op) {
    case "put": {
      return classifyPut(listings, change);
    }
    case "delete": {
      return classifyDelete(listings, change.path, change.base);
    }
    case "move": {
      return classifyMove(listings, change.from, change.to, change.base);
    }
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
};

// The cell decodes names leniently, so a name that is not UTF-8 lists as another name, and a tree
// rebuilt from that listing would silently rename the sibling. A listing that hashes back to its
// own oid, each name once, is exactly the tree the cell holds.
const isLossless = async (listing: TreeResult): Promise<boolean> => {
  const names = new Set(listing.entries.map((entry) => entry.name));
  if (names.size !== listing.entries.length) {
    return false;
  }
  const entries = listing.entries.map(({ mode, name, oid }): GitTreeEntry => ({
    mode,
    name: encoder.encode(name),
    oid,
  }));
  const rebuilt = await gitObject("tree", serializeTree(entries));
  return rebuilt.oid === listing.oid;
};

// a folder rewritten by this commit is named by its path until its own tree is hashed
type FolderEntry =
  | { readonly kind: "object"; readonly mode: string; readonly oid: string }
  | { readonly kind: "folder"; readonly path: string };

type Folders = Map<string, Map<string, FolderEntry>>;

const depthOf = (path: string): number => (path === "" ? 0 : path.split("/").length);

// the rewritten folders as the commit will hold them: leaves applied, a folder the set empties
// pruned from its parent, a folder it creates added to one
const rewrittenFolders = (listings: Listings, edits: readonly LeafEdit[]): Folders => {
  const folders: Folders = new Map();
  const folderAt = (path: string): Map<string, FolderEntry> => {
    const known = folders.get(path);
    if (known !== undefined) {
      return known;
    }
    const entries = new Map<string, FolderEntry>(
      (listings.get(path)?.entries ?? []).map(({ mode, name, oid }) => [
        name,
        { kind: "object", mode, oid },
      ]),
    );
    folders.set(path, entries);
    return entries;
  };
  for (const edit of edits) {
    for (const folder of foldersAbove(edit.path)) {
      folderAt(folder);
    }
    const entries = folderAt(parentOf(edit.path));
    if (edit.entry === null) {
      entries.delete(nameOf(edit.path));
    } else {
      entries.set(nameOf(edit.path), { kind: "object", ...edit.entry });
    }
  }
  const deepestFirst = [...folders.keys()].toSorted((a, b) => depthOf(b) - depthOf(a));
  for (const path of deepestFirst) {
    if (path !== "") {
      const parent = folderAt(parentOf(path));
      if (folders.get(path)?.size === 0) {
        parent.delete(nameOf(path));
        folders.delete(path);
      } else {
        parent.set(nameOf(path), { kind: "folder", path });
      }
    }
  }
  return folders;
};

// the first name along the path the head does not hold, with the folder it would join
const introducedName = (
  listings: Listings,
  path: string,
): { readonly folder: string; readonly name: string } | null => {
  let folder = "";
  for (const name of path.split("/")) {
    if (listings.get(folder)?.entries.some((entry) => entry.name === name) !== true) {
      return { folder, name };
    }
    folder = joinPath(folder, name);
  }
  return null;
};

const collides = (listings: Listings, folders: Folders, path: string): boolean => {
  const introduced = introducedName(listings, path);
  if (introduced === null) {
    return false;
  }
  const key = vaultCollisionKey(introduced.name);
  return [...(folders.get(introduced.folder)?.keys() ?? [])].some(
    (name) => name !== introduced.name && vaultCollisionKey(name) === key,
  );
};

// what only the set as a whole can break: a file one change writes where another needs a
// folder, and a name that a sibling already holds in another case or normalization
const structuralConflicts = (
  listings: Listings,
  folders: Folders,
  edits: readonly LeafEdit[],
): PendingConflict[] => {
  const written = new Set(edits.filter((edit) => edit.entry !== null).map((edit) => edit.path));
  return edits.flatMap((edit): PendingConflict[] => {
    if (foldersAbove(edit.path).some((folder) => written.has(folder))) {
      return [{ entry: null, path: edit.path, reason: "blocked" }];
    }
    if (edit.entry !== null && collides(listings, folders, edit.path)) {
      return [{ entry: null, path: edit.path, reason: "case-collision" }];
    }
    return [];
  });
};

const hashFolder = async (folders: Folders, path: string, trees: GitObject[]): Promise<string> => {
  const entries: GitTreeEntry[] = [];
  for (const [name, entry] of folders.get(path) ?? []) {
    entries.push(
      entry.kind === "folder"
        ? {
            mode: TREE_MODE,
            name: encoder.encode(name),
            oid: await hashFolder(folders, entry.path, trees),
          }
        : { mode: entry.mode, name: encoder.encode(name), oid: entry.oid },
    );
  }
  const tree = await treeObject(entries);
  trees.push(tree);
  return tree.oid;
};

type Plan =
  | { readonly kind: "conflict"; readonly conflicts: readonly PendingConflict[] }
  | { readonly kind: "satisfied" }
  | {
      readonly kind: "commit";
      readonly root: string;
      readonly objects: readonly GitObject[];
      readonly touched: readonly string[];
    };

const planAgainst = async (
  stub: DurableObjectStub<RepoCell>,
  head: Head,
  changes: readonly PreparedChange[],
): Promise<Plan> => {
  const listings = await listFolders(stub, head.commit, changes);
  const lossless = new Map<string, Promise<boolean>>();
  const isWritable = async (path: string): Promise<boolean> => {
    for (const folder of foldersAbove(path)) {
      const listing = listings.get(folder);
      if (listing !== null && listing !== undefined) {
        const verdict = lossless.get(folder) ?? isLossless(listing);
        lossless.set(folder, verdict);
        if (!(await verdict)) {
          return false;
        }
      }
    }
    return true;
  };
  const firstUnwritable = async (edits: readonly LeafEdit[]): Promise<string | null> => {
    for (const edit of edits) {
      if (!(await isWritable(edit.path))) {
        return edit.path;
      }
    }
    return null;
  };

  const conflicts: PendingConflict[] = [];
  const applied: { readonly change: PreparedChange; readonly edits: readonly LeafEdit[] }[] = [];
  for (const change of changes) {
    const verdict = classify(listings, change);
    if (verdict.kind === "conflict") {
      conflicts.push(verdict.conflict);
    } else if (verdict.kind === "applicable") {
      const unwritable = await firstUnwritable(verdict.edits);
      if (unwritable === null) {
        applied.push({ change, edits: verdict.edits });
      } else {
        conflicts.push({
          entry: entryAt(listings, unwritable),
          path: unwritable,
          reason: "unwritable",
        });
      }
    }
  }

  const edits = applied.flatMap(({ edits: own }) => own);
  const folders = rewrittenFolders(listings, edits);
  conflicts.push(...structuralConflicts(listings, folders, edits));
  if (conflicts.length > 0) {
    return { conflicts, kind: "conflict" };
  }
  if (applied.length === 0) {
    return { kind: "satisfied" };
  }
  const trees: GitObject[] = [];
  const root = await hashFolder(folders, "", trees);
  const blobs = applied.flatMap(({ change }) => (change.op === "put" ? [change.blob] : []));
  return {
    kind: "commit",
    objects: [...blobs, ...trees],
    root,
    touched: applied.flatMap(({ change }) => pathsOf(change)),
  };
};

const decodeText = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
};

const describeConflicts = async (
  stub: DurableObjectStub<RepoCell>,
  commit: string,
  pending: readonly PendingConflict[],
): Promise<VaultConflict[]> => {
  let budget = CONFLICT_INLINE_BYTES;
  const inline = pending.map(({ entry }) => {
    const size = entry !== null && isRegularFile(entry) ? entry.size : undefined;
    if (size === undefined || size > VAULT_FILE_MAX_BYTES || size > budget) {
      return false;
    }
    budget -= size;
    return true;
  });
  return await Promise.all(
    pending.map(async ({ entry, path, reason }, index): Promise<VaultConflict> => {
      const [text, log] = await Promise.all([
        inline[index] === true
          ? stub
              .readBlob(commit, encodeGitPath(path))
              .then((blob) => (blob === null ? undefined : decodeText(blob.data)))
          : undefined,
        stub.listLog(commit, { n: 1, path: encodeGitPath(path) }),
      ]);
      let current: VaultConflict["current"] = null;
      if (entry !== null) {
        current = text === undefined ? { oid: entry.oid } : { content: text, oid: entry.oid };
      }
      return { current, device: log.commits[0]?.committer.name ?? null, path, reason };
    }),
  );
};

// spelled like the desktop engine's own commits, so the history reads one way whichever device
// wrote it
const commitSubject = (paths: readonly string[]): string => {
  const [only] = paths;
  return paths.length === 1 && only !== undefined
    ? `vault: update ${only}`
    : `vault: update ${String(paths.length)} files`;
};

export const commitChanges = async ({
  author,
  authoredAt,
  changes,
  now,
  send,
  stub,
}: CommitChangesArgs): Promise<CommitChangesResult> => {
  const named = changes.flatMap(pathsOf);
  if (new Set(named).size !== named.length) {
    throw new Error("a change set names a path twice");
  }
  const prepared = await Promise.all(changes.map(prepare));
  const results = prepared.map(resultOf);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const head = await readHead(stub);
    if (head === null) {
      return { kind: "no-head" };
    }
    const plan = await planAgainst(stub, head, prepared);
    if (plan.kind === "conflict") {
      return {
        conflicts: await describeConflicts(stub, head.commit, plan.conflicts),
        head: head.commit,
        kind: "conflict",
      };
    }
    if (plan.kind === "satisfied") {
      return { commit: head.commit, kind: "committed", results };
    }
    const commit = await commitObject({
      author: gitIdent(
        { email: deviceEmail(author.deviceId), name: author.deviceName },
        authoredAt,
      ),
      committer: gitIdent({ email: WORKER_COMMITTER_EMAIL, name: author.deviceName }, now),
      message: commitSubject(plan.touched),
      parents: [head.commit],
      tree: plan.root,
    });
    const outcome = await send({
      next: commit.oid,
      old: head.target,
      pack: await writePack([...plan.objects, commit]),
      ref: head.ref,
    });
    if (outcome.kind === "applied") {
      return { commit: commit.oid, kind: "committed", results };
    }
    if (outcome.kind === "full") {
      return { kind: "full" };
    }
    if (outcome.kind === "refused") {
      return { kind: "refused", reason: outcome.reason };
    }
  }
  return { kind: "exhausted" };
};
