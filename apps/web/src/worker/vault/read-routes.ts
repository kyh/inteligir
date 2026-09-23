import {
  assetMediaType,
  VAULT_API_PATHS,
  VAULT_ASSET_MAX_BYTES,
  VAULT_FILE_MAX_BYTES,
  VAULT_TREE_MAX_ENTRIES,
  vaultAssetQuerySchema,
  vaultFileQuerySchema,
  vaultTreeQuerySchema,
} from "@repo/api/cloud/vault/vault-schema";
import type { VaultFileResponse } from "@repo/api/cloud/vault/vault-schema";
import type { RepoCell } from "durable-git";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import { allowInWindow, deviceRateKey } from "../rate-limit";
import type { RateWindow } from "../rate-limit";
import { vaultRegistry, vaultRepoName } from "./git-remote";
import { treeListingSlot } from "./tree-listing";
import type { TreeListingSlot } from "./tree-listing";
import { pageTree, walkTree } from "./tree-walk";
import type { TreeWalkRefusal } from "./tree-walk";

const MAX_TREE_DIRS = 10_000;

// the walk that fills the listing slot holds the whole listing in memory, so a vault past this
// many entries is walked page by page and never kept.
const MAX_KEPT_LISTING = 50_000;

// the legitimate burst is one note's embeds, which the format does not bound; this breaks a runaway
// loop, and a note past it sees its tail answered 429.
const VAULT_READ_WINDOW: RateWindow = { max: 3000, windowMs: 60_000 };

const resolveCommit = async (
  stub: DurableObjectStub<RepoCell>,
  ref: string | undefined,
): Promise<string | null> => {
  if (ref !== undefined) {
    return ref;
  }
  const head = await stub.readCommit();
  return head === null ? null : head.oid;
};

// durable-git url-decodes every path it receives, so a legal filename holding % must be encoded per
// segment.
const encodeGitPath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

const refuseWalk = (refusal: TreeWalkRefusal): Response =>
  refusal === "missing"
    ? refuse("not-found", "This vault has no content at that revision.")
    : refuse("internal", `Vault tree exceeds ${String(MAX_TREE_DIRS)} directories.`);

const answerTree = async (
  stub: DurableObjectStub<RepoCell>,
  slot: TreeListingSlot,
  url: URL,
): Promise<Response> => {
  const query = vaultTreeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) {
    return refuse("bad-request", "Send ?ref=<sha>&after=<path>&limit=<1..500>, each optional.");
  }
  const { after, ref } = query.data;
  const limit = query.data.limit ?? VAULT_TREE_MAX_ENTRIES;

  const commit = await resolveCommit(stub, ref);
  if (commit === null) {
    return refuse("not-found", "This vault has no content at that revision.");
  }

  const kept = await slot.read(commit);
  if (kept !== null) {
    return Response.json(pageTree(commit, kept, after, limit));
  }

  const listTree = async (dir: string) => await stub.listTree(commit, encodeGitPath(dir));
  // a read that resolved the head starts a paging, so it walks the vault whole and keeps it. A
  // pinned miss does not fill: a newer head took the slot, and taking it back would make every
  // device paging that head walk.
  if (ref === undefined) {
    const whole = await walkTree({ keep: MAX_KEPT_LISTING + 1, listTree, maxDirs: MAX_TREE_DIRS });
    if (!whole.ok) {
      return refuseWalk(whole.refusal);
    }
    if (whole.files.length <= MAX_KEPT_LISTING) {
      await slot.write(commit, whole.files);
      return Response.json(pageTree(commit, whole.files, after, limit));
    }
  }

  const walked = await walkTree({ after, keep: limit + 1, listTree, maxDirs: MAX_TREE_DIRS });
  if (!walked.ok) {
    return refuseWalk(walked.refusal);
  }
  return Response.json(pageTree(commit, walked.files, after, limit));
};

const answerFile = async (stub: DurableObjectStub<RepoCell>, url: URL): Promise<Response> => {
  const query = vaultFileQuerySchema.safeParse(Object.fromEntries(url.searchParams));
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
    content,
    oid: blob.oid,
    path: query.data.path,
  };
  return Response.json(response);
};

// the sandbox csp is what makes svg safe: <img> never runs its script, but a navigation to this url
// renders it as a document, and a sandbox with no allow-scripts refuses that. immutable holds
// because the url pins a commit.
const ASSET_HEADERS = {
  "cache-control": "private, max-age=31536000, immutable",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

const answerAsset = async (stub: DurableObjectStub<RepoCell>, url: URL): Promise<Response> => {
  const query = vaultAssetQuerySchema.safeParse(Object.fromEntries(url.searchParams));
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
  const parentDir = slash === -1 ? "" : query.data.path.slice(0, slash);
  const leaf = slash === -1 ? query.data.path : query.data.path.slice(slash + 1);
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
};

export const handleVaultReadRoutes = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  if (request.method !== "GET") {
    return refuse("not-found", "No such route.");
  }

  const db = createDb(env.DB);
  const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
  if (verified === null) {
    return refuse("unauthorized", "No valid device credential.");
  }

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
    return await answerTree(stub, treeListingSlot(env.PACK_CACHE, repo), url);
  }
  if (url.pathname === VAULT_API_PATHS.file) {
    return await answerFile(stub, url);
  }
  if (url.pathname === VAULT_API_PATHS.asset) {
    return await answerAsset(stub, url);
  }
  return refuse("not-found", "No such route.");
};
