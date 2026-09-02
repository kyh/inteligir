import {
  assetMediaType,
  isIgnoredEntryName,
  VAULT_API_PATHS,
  VAULT_ASSET_MAX_BYTES,
  VAULT_FILE_MAX_BYTES,
  VAULT_TREE_MAX_ENTRIES,
  vaultAssetQuerySchema,
  vaultFileQuerySchema,
  vaultTreeQuerySchema,
  type VaultFileResponse,
  type VaultTreeResponse,
} from "@repo/api/cloud/vault/vault-schema";
import type { RepoCell } from "durable-git";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import { allowInWindow, deviceRateKey, type RateWindow } from "../rate-limit";
import { vaultRegistry, vaultRepoName } from "./git-remote";

const MAX_TREE_DIRS = 10_000;

// the legitimate burst is one note's embeds, which the format does not bound; this breaks a runaway
// loop, and a note past it sees its tail answered 429.
const VAULT_READ_WINDOW: RateWindow = { max: 3_000, windowMs: 60_000 };

export async function handleVaultReadRoutes(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") return refuse("not-found", "No such route.");

  const db = createDb(env.DB);
  const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
  if (verified === null) return refuse("unauthorized", "No valid device credential.");

  if (
    !(await allowInWindow(
      env,
      db,
      deviceRateKey("vaultRead", verified.deviceId),
      VAULT_READ_WINDOW,
    ))
  ) {
    return refuse("rate-limited", "Too many vault reads from this device — wait a minute.");
  }

  const repo = vaultRepoName(verified.userId);
  // getByName on the repo namespace creates a cell, and a BYO-remote phone polls the unpinned tree
  // forever; the registry answers "no vault" without materializing one per poll. a pinned ref
  // already passed this gate.
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
  if (url.pathname === VAULT_API_PATHS.asset) {
    return await answerAsset(stub, url);
  }
  return refuse("not-found", "No such route.");
}

async function resolveCommit(
  stub: DurableObjectStub<RepoCell>,
  ref: string | undefined,
): Promise<string | null> {
  if (ref !== undefined) return ref;
  const head = await stub.readCommit(undefined);
  return head === null ? null : head.oid;
}

// durable-git url-decodes every path it receives, so a legal filename holding % must be encoded per
// segment.
function encodeGitPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

// list only what the file route answers: git allows any byte but NUL and `/` in a name, and one
// pushed `a\b.md` would otherwise fail the phone's parse of the whole listing.
function servable(path: string): boolean {
  return vaultFileQuerySchema.safeParse({ path }).success;
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

// every path under dir starts with dir + "/", so a cursor past that prefix and not inside it is
// past the subtree.
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

  // one round of concurrent cell calls per BFS level, and only the limit + 1 smallest paths survive
  // a level, so a wide vault never materializes a full listing.
  const limit = query.data.limit ?? VAULT_TREE_MAX_ENTRIES;
  let files: VaultTreeResponse["entries"][number][] = [];
  let frontier = [""];
  let visited = 0;
  while (frontier.length > 0) {
    visited += frontier.length;
    if (visited > MAX_TREE_DIRS) {
      return refuse("internal", `Vault tree exceeds ${String(MAX_TREE_DIRS)} directories.`);
    }
    const trees = await Promise.all(
      frontier.map((dir) => stub.listTree(commit, encodeGitPath(dir))),
    );
    const next: string[] = [];
    for (const [index, tree] of trees.entries()) {
      const dir = frontier[index];
      if (tree === null || dir === undefined) {
        return refuse("not-found", "This vault has no content at that revision.");
      }
      for (const entry of tree.entries) {
        if (isIgnoredEntryName(entry.name)) continue;
        const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
        if (!servable(path)) continue;
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
  const blob = await stub.readBlob(commit, encodeGitPath(query.data.path));
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

// the sandbox csp is what makes svg safe: <img> never runs its script, but a navigation to this url
// renders it as a document, and a sandbox with no allow-scripts refuses that. immutable holds
// because the url pins a commit.
const ASSET_HEADERS = {
  "cache-control": "private, max-age=31536000, immutable",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

async function answerAsset(stub: DurableObjectStub<RepoCell>, url: URL): Promise<Response> {
  const query = vaultAssetQuerySchema.safeParse({
    path: url.searchParams.get("path") ?? undefined,
    ref: url.searchParams.get("ref") ?? undefined,
  });
  if (!query.success) {
    return refuse("bad-request", "Send ?path=<vault-relative path>&ref=<sha> — both required.");
  }
  const mediaType = assetMediaType(query.data.path);
  if (mediaType === null) {
    return refuse("bad-request", "That extension is not an image type this vault serves.");
  }

  // size-gate from the tree first: readBlob inflates the whole blob in the cell and the rpc return
  // has its own message bound, so a huge asset gated after the hop surfaces as an opaque 500.
  const slash = query.data.path.lastIndexOf("/");
  const parentDir = slash < 0 ? "" : query.data.path.slice(0, slash);
  const leaf = slash < 0 ? query.data.path : query.data.path.slice(slash + 1);
  const parentTree = await stub.listTree(query.data.ref, encodeGitPath(parentDir));
  if (parentTree === null) {
    return refuse("not-found", "That revision does not carry the path.");
  }
  const entry = parentTree.entries.find((row) => row.name === leaf && row.type === "blob");
  if (entry === undefined) {
    return refuse("not-found", "That revision does not carry the path.");
  }
  if (entry.size !== undefined && entry.size > VAULT_ASSET_MAX_BYTES) {
    return refuse(
      "file-too-large",
      `Assets over ${String(VAULT_ASSET_MAX_BYTES)} bytes do not cross this wire.`,
    );
  }

  const blob = await stub.readBlob(query.data.ref, encodeGitPath(query.data.path));
  if (blob === null) {
    return refuse("not-found", "That revision does not carry the path.");
  }
  // an entry with no size skips the tree gate.
  if (blob.data.length > VAULT_ASSET_MAX_BYTES) {
    return refuse(
      "file-too-large",
      `Assets over ${String(VAULT_ASSET_MAX_BYTES)} bytes do not cross this wire.`,
    );
  }
  return new Response(blob.data, {
    headers: { ...ASSET_HEADERS, "content-type": mediaType, etag: `"${blob.oid}"` },
  });
}
