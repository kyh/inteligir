import {
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
import { vaultRepoName } from "./git-remote";

// ---------------------------------------------------------------------------
// `/v1/vault/tree` + `/v1/vault/file` — how a client with no git client (the
// phone) reads notes out of the hosted vault. Device-authed GETs over the
// repo cell's typed RPC; dgit's own HTTP API stays off the wire (the git
// wrapper's rule 2), so this module is the ONE read surface and our /cloud
// schemas are the one wire truth.
//
// THE REGISTRY IS CONSULTED BEFORE THE REPO IS NAMED. `getByName` on the
// REPO namespace CREATES a cell, and a phone on a BYO-remote account polls
// these routes forever with no hosted vault to find — the registry (one
// singleton, a lookup that creates nothing) answers "no vault yet" without
// materializing an empty billable cell per poll.
//
// Both responses carry the COMMIT they were read at, resolved once per
// request: a paged tree walk passes it back as `ref`, so later pages read
// the same tree whatever a device pushes in between.
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
  const info = await env.REGISTRY.getByName("registry").get(repo);
  if (info === null) {
    return refuse("not-found", "This account has no hosted vault yet.");
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

/** Resolve the commit this request reads at: the query's pinned sha, or the
 *  current HEAD. Null when neither names a commit the repo holds. */
async function resolveCommit(
  stub: DurableObjectStub<RepoCell>,
  ref: string | undefined,
): Promise<string | null> {
  const commit = await stub.readCommit(ref);
  return commit === null ? null : commit.oid;
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

  const commit = await resolveCommit(stub, query.data.ref);
  if (commit === null) {
    return refuse("not-found", "This vault has no content at that revision.");
  }

  // A full flat walk per page, filtered by the cursor after: the walk is
  // what a git-less client would otherwise do itself, one round trip per
  // directory, and the vault's own layout (plain nested markdown) keeps it
  // shallow. Sorted so the cursor is total.
  const files: VaultTreeResponse["entries"][number][] = [];
  const dirs: string[] = [""];
  let visited = 0;
  while (dirs.length > 0) {
    const dir = dirs.shift();
    if (dir === undefined) break;
    visited += 1;
    if (visited > MAX_TREE_DIRS) {
      return refuse("internal", `Vault tree exceeds ${String(MAX_TREE_DIRS)} directories.`);
    }
    const tree = await stub.listTree(commit, dir);
    if (tree === null) {
      return refuse("not-found", "This vault has no content at that revision.");
    }
    for (const entry of tree.entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.type === "tree") {
        dirs.push(path);
      } else if (entry.type === "blob") {
        files.push({ path, size: entry.size ?? 0 });
      }
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const after = query.data.after;
  const from = after === undefined ? files : files.filter((file) => file.path > after);
  const limit = query.data.limit ?? VAULT_TREE_MAX_ENTRIES;
  const page = from.slice(0, limit);
  const last = page.at(-1);
  const response: VaultTreeResponse = {
    commit,
    entries: page,
    next: from.length > page.length && last !== undefined ? last.path : null,
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
