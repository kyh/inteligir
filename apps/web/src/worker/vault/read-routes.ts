import {
  isReservedVaultSegment,
  VAULT_API_PATHS,
  VAULT_FILE_MAX_BYTES,
  VAULT_TREE_MAX_ENTRIES,
  vaultFileQuerySchema,
  vaultTreeQuerySchema,
  type VaultFileResponse,
  type VaultTreeResponse,
} from "@repo/api/cloud/vault/vault-schema";
import type { RepoCell } from "durable-git";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import { vaultRegistry, vaultRepoName } from "./git-remote";

// ---------------------------------------------------------------------------
// `/v1/vault/tree` + `/v1/vault/file` — how a client with no git client (the
// phone) reads notes out of the hosted vault. Device-authed GETs over the
// repo cell's typed RPC; dgit's own HTTP API stays off the wire (the git
// wrapper's rule 2), so this module is the ONE read surface and our /cloud
// schemas are the one wire truth.
//
// THE REGISTRY IS CONSULTED BEFORE THE REPO IS NAMED — but only when the
// request pins no `ref`. `getByName` on the REPO namespace CREATES a cell,
// and a phone on a BYO-remote account polls the unpinned tree forever with
// no hosted vault to find; the registry (one singleton, a lookup that
// creates nothing) answers "no vault yet" without materializing an empty
// cell per poll. A request that DOES pin a sha already holds a page that
// passed this gate, so it skips the singleton hop.
//
// Both responses carry the COMMIT they were read at: an unpinned request
// resolves HEAD once; a pinned one uses its sha directly (`readBlob`/
// `listTree` resolve reachable oids themselves), so the phone's hot path —
// opening a note at the listing's commit — costs one repo-cell hop.
// ---------------------------------------------------------------------------

/** Bounds the recursive walk, and states its own failure: a vault with more
 *  directories than this cannot answer a FLAT listing honestly, and silent
 *  truncation would read as "covered everything". */
const MAX_TREE_DIRS = 10_000;

export async function handleVaultReadRoutes(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") return refuse("not-found", "No such route.");

  const verified = await verifyDeviceCredential(
    createDb(env.DB),
    request.headers.get("authorization"),
  );
  if (verified === null) return refuse("unauthorized", "No valid device credential.");

  const repo = vaultRepoName(verified.userId);
  if (url.searchParams.get("ref") === null) {
    const info = await vaultRegistry(env).get(repo);
    if (info === null) {
      return refuse("not-found", "This account has no hosted vault yet.");
    }
  }
  const stub = env.REPO.getByName(repo);

  if (url.pathname === VAULT_API_PATHS.tree) {
    return await answerTree(stub, url);
  }
  if (url.pathname === VAULT_API_PATHS.file) {
    return await answerFile(stub, url);
  }
  return refuse("not-found", "No such route.");
}

/** The commit this request reads at: the query's pinned sha as-is, or HEAD
 *  resolved once. Null when the repo has no HEAD yet; a pinned sha that names
 *  nothing surfaces as the read itself answering null. */
async function resolveCommit(
  stub: DurableObjectStub<RepoCell>,
  ref: string | undefined,
): Promise<string | null> {
  if (ref !== undefined) return ref;
  const head = await stub.readCommit(undefined);
  return head === null ? null : head.oid;
}

/** Whether any path under `dir` can still be beyond the cursor — the subtree
 *  prune that keeps a later page from re-walking directories it has wholly
 *  passed. Every path under `dir` starts with `dir + "/"`, so a cursor that
 *  is lexicographically past that prefix (and not inside it) is past the
 *  whole subtree. */
function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function subtreeReaches(dir: string, after: string | undefined): boolean {
  if (after === undefined) return true;
  const prefix = `${dir}/`;
  return after < prefix || after.startsWith(prefix);
}

async function answerTree(stub: DurableObjectStub<RepoCell>, url: URL): Promise<Response> {
  const limitRaw = url.searchParams.get("limit");
  const query = vaultTreeQuerySchema.safeParse({
    ref: url.searchParams.get("ref") ?? undefined,
    after: url.searchParams.get("after") ?? undefined,
    limit: limitRaw === null ? undefined : Number(limitRaw),
  });
  if (!query.success) {
    return refuse("bad-request", "Send ?ref=<sha>&after=<path>&limit=<1..500>, each optional.");
  }
  const after = query.data.after;

  const commit = await resolveCommit(stub, query.data.ref);
  if (commit === null) {
    return refuse("not-found", "This vault has no content at that revision.");
  }

  // Level-parallel walk: each BFS level's directories are independent, so a
  // level is ONE round of concurrent repo-cell calls rather than one call per
  // directory — wall time scales with the tree's depth, not its width.
  //
  // MEMORY is bounded to the page: the walk keeps only the `limit + 1`
  // smallest candidate paths (a later, smaller path still displaces a kept
  // larger one), so a very wide vault costs a trim per level, never a full
  // materialized listing.
  const limit = query.data.limit ?? VAULT_TREE_MAX_ENTRIES;
  let files: VaultTreeResponse["entries"][number][] = [];
  let frontier = [""];
  let visited = 0;
  while (frontier.length > 0) {
    visited += frontier.length;
    if (visited > MAX_TREE_DIRS) {
      return refuse("internal", `Vault tree exceeds ${String(MAX_TREE_DIRS)} directories.`);
    }
    const trees = await Promise.all(frontier.map((dir) => stub.listTree(commit, dir)));
    const next: string[] = [];
    for (const [index, tree] of trees.entries()) {
      const dir = frontier[index];
      if (tree === null || dir === undefined) {
        return refuse("not-found", "This vault has no content at that revision.");
      }
      for (const entry of tree.entries) {
        if (isReservedVaultSegment(entry.name)) continue;
        const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
        if (entry.type === "tree") {
          if (subtreeReaches(path, after)) next.push(path);
        } else if (entry.type === "blob" && (after === undefined || path > after)) {
          files.push({ path, size: entry.size ?? 0 });
        }
      }
    }
    if (files.length > limit + 1) {
      files.sort(byPath);
      files = files.slice(0, limit + 1);
    }
    frontier = next;
  }
  files.sort(byPath);

  const page = files.slice(0, limit);
  const last = page.at(-1);
  const response: VaultTreeResponse = {
    commit,
    entries: page,
    next: files.length > page.length && last !== undefined ? last.path : null,
  };
  return Response.json(response);
}

async function answerFile(stub: DurableObjectStub<RepoCell>, url: URL): Promise<Response> {
  const query = vaultFileQuerySchema.safeParse({
    path: url.searchParams.get("path") ?? undefined,
    ref: url.searchParams.get("ref") ?? undefined,
  });
  if (!query.success) {
    return refuse("bad-request", "Send ?path=<vault-relative path>&ref=<sha, optional>.");
  }

  const commit = await resolveCommit(stub, query.data.ref);
  if (commit === null) {
    return refuse("not-found", "This vault has no content at that revision.");
  }
  const blob = await stub.readBlob(commit, query.data.path);
  if (blob === null) {
    return refuse("not-found", "That revision does not carry the path.");
  }
  if (blob.data.length > VAULT_FILE_MAX_BYTES) {
    return refuse(
      "file-too-large",
      `Files over ${String(VAULT_FILE_MAX_BYTES)} bytes do not cross this wire.`,
    );
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(blob.data);
  } catch {
    // The phone reads NOTES; a binary needs its own asset route, not a
    // mangled lossy decode.
    return refuse("bad-request", "That file is not UTF-8 text.");
  }
  const response: VaultFileResponse = {
    commit,
    path: query.data.path,
    oid: blob.oid,
    content,
  };
  return Response.json(response);
}
