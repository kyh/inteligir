import {
  assetMediaType,
  VAULT_API_PATHS,
  VAULT_ASSET_MAX_BYTES,
  VAULT_FILE_MAX_BYTES,
  VAULT_FILES_MAX_PATHS,
  VAULT_FILES_MAX_RESPONSE_BYTES,
  VAULT_TREE_MAX_ENTRIES,
  vaultAssetQuerySchema,
  vaultFileQuerySchema,
  vaultFilesRequestSchema,
  vaultTreeQuerySchema,
} from "@repo/contract/cloud/vault/vault-schema";
import type {
  VaultAssetQuery,
  VaultFileQuery,
  VaultFileRefusal,
  VaultFileResponse,
  VaultFilesRequest,
  VaultFilesResponse,
  VaultTreeQuery,
} from "@repo/contract/cloud/vault/vault-schema";
import type { RepoCell } from "durable-git";
import type { z } from "zod";
import { refuse, refuseNoDeviceCredential } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import { spendDeviceBudget } from "../rate-limit";
import { vaultRegistry, vaultRepoName } from "./vault-repo";
import { treeListingSlot } from "./tree-listing";
import type { TreeListingSlot } from "./tree-listing";
import { encodeGitPath, pageTree, walkTree } from "./tree-walk";
import type { TreeWalkRefusal } from "./tree-walk";

const MAX_TREE_DIRS = 10_000;

// the walk that fills the listing slot holds the whole listing in memory, so a vault past this
// many entries is walked page by page and never kept.
const MAX_KEPT_LISTING = 50_000;

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

const refuseWalk = (refusal: TreeWalkRefusal): Response =>
  refusal === "missing"
    ? refuse("not-found", "This vault has no content at that revision.")
    : refuse("internal", `Vault tree exceeds ${String(MAX_TREE_DIRS)} directories.`);

const answerTree = async (
  stub: DurableObjectStub<RepoCell>,
  slot: TreeListingSlot,
  query: VaultTreeQuery,
): Promise<Response> => {
  const { after, ref } = query;
  const limit = query.limit ?? VAULT_TREE_MAX_ENTRIES;

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

type BlobText = { ok: true; content: string } | { ok: false; refusal: VaultFileRefusal };

// the one gate both file routes run: the wire carries UTF-8 text under the byte ceiling
const blobText = (data: Uint8Array): BlobText => {
  if (data.length > VAULT_FILE_MAX_BYTES) {
    return { ok: false, refusal: "file-too-large" };
  }
  try {
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data);
    return { content, ok: true };
  } catch {
    return { ok: false, refusal: "not-text" };
  }
};

const answerFile = async (
  stub: DurableObjectStub<RepoCell>,
  query: VaultFileQuery,
): Promise<Response> => {
  const commit = await resolveCommit(stub, query.ref);
  if (commit === null) {
    return refuse("not-found", "This vault has no content at that revision.");
  }
  const blob = await stub.readBlob(commit, encodeGitPath(query.path));
  if (blob === null) {
    return refuse("not-found", "That revision does not carry the path.");
  }
  const text = blobText(blob.data);
  if (!text.ok) {
    return text.refusal === "file-too-large"
      ? refuse(
          "file-too-large",
          `Files over ${String(VAULT_FILE_MAX_BYTES)} bytes do not cross this wire.`,
        )
      : refuse("bad-request", "That file is not UTF-8 text.");
  }
  const response: VaultFileResponse = {
    commit,
    content: text.content,
    oid: blob.oid,
    path: query.path,
  };
  return Response.json(response);
};

// each read is a round trip into the cell, so a batch overlaps a few rather than walking its
// paths one by one; only a few, because every blob in flight is held in memory at once
const READS_IN_FLIGHT = 8;

const answerFiles = async (
  stub: DurableObjectStub<RepoCell>,
  request: VaultFilesRequest,
): Promise<Response> => {
  const { paths, ref } = request;
  // at a revision the repo does not hold every path would read as missing, which a mirror takes
  // for a deletion
  if ((await stub.readCommit(ref)) === null) {
    return refuse("not-found", "This vault has no content at that revision.");
  }

  const files: VaultFilesResponse["files"] = [];
  const missing: string[] = [];
  const refused: VaultFilesResponse["refused"] = [];
  const answer = (deferred: string[]): Response => {
    const response: VaultFilesResponse = { commit: ref, deferred, files, missing, refused };
    return Response.json(response);
  };

  let spent = 0;
  for (let start = 0; start < paths.length; start += READS_IN_FLIGHT) {
    const read = await Promise.all(
      paths.slice(start, start + READS_IN_FLIGHT).map(async (path) => ({
        blob: await stub.readBlob(ref, encodeGitPath(path)),
        path,
      })),
    );
    for (const [offset, { blob, path }] of read.entries()) {
      if (blob === null) {
        missing.push(path);
        continue;
      }
      const text = blobText(blob.data);
      if (!text.ok) {
        refused.push({ code: text.refusal, path });
        continue;
      }
      if (files.length > 0 && spent + blob.data.length > VAULT_FILES_MAX_RESPONSE_BYTES) {
        return answer(paths.slice(start + offset));
      }
      spent += blob.data.length;
      files.push({ content: text.content, oid: blob.oid, path });
    }
  }
  return answer([]);
};

// the sandbox csp is what makes svg safe: <img> never runs its script, but a navigation to this url
// renders it as a document, and a sandbox with no allow-scripts refuses that. immutable holds
// because the read pins a commit.
const ASSET_HEADERS = {
  "cache-control": "private, max-age=31536000, immutable",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

const answerAsset = async (
  stub: DurableObjectStub<RepoCell>,
  query: VaultAssetQuery,
): Promise<Response> => {
  const mediaType = assetMediaType(query.path);
  if (mediaType === null) {
    return refuse("bad-request", "That extension is not an image type this vault serves.");
  }

  // size-gate from the tree first: readBlob inflates the whole blob in the cell and the rpc return
  // has its own message bound, so a huge asset gated after the hop surfaces as an opaque 500.
  const slash = query.path.lastIndexOf("/");
  const parentDir = slash === -1 ? "" : query.path.slice(0, slash);
  const leaf = slash === -1 ? query.path : query.path.slice(slash + 1);
  const parentTree = await stub.listTree(query.ref, encodeGitPath(parentDir));
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

  const blob = await stub.readBlob(query.ref, encodeGitPath(query.path));
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

interface ReadRoute<Q extends { readonly ref?: string | undefined }> {
  readonly schema: z.ZodType<Q>;
  readonly usage: string;
  readonly answer: (
    stub: DurableObjectStub<RepoCell>,
    query: Q,
    env: Env,
    repo: string,
  ) => Promise<Response>;
}

interface VaultReadQueries {
  readonly [VAULT_API_PATHS.tree]: VaultTreeQuery;
  readonly [VAULT_API_PATHS.file]: VaultFileQuery;
  readonly [VAULT_API_PATHS.files]: VaultFilesRequest;
  readonly [VAULT_API_PATHS.asset]: VaultAssetQuery;
}

type VaultReadPath = keyof VaultReadQueries;

// a mapped type, so indexing it by a generic path keeps each row's schema paired with its answer
type VaultReadRoutes = { readonly [P in VaultReadPath]: ReadRoute<VaultReadQueries[P]> };

const VAULT_READS: VaultReadRoutes = {
  [VAULT_API_PATHS.tree]: {
    answer: async (stub, query, env, repo) =>
      await answerTree(stub, treeListingSlot(env.PACK_CACHE, repo), query),
    schema: vaultTreeQuerySchema,
    usage: `Send {"ref": <sha>, "after": <path>, "limit": <1..${String(VAULT_TREE_MAX_ENTRIES)}>}, each optional.`,
  },
  [VAULT_API_PATHS.file]: {
    answer: answerFile,
    schema: vaultFileQuerySchema,
    usage: 'Send {"path": <vault-relative path>, "ref": <sha, optional>}.',
  },
  [VAULT_API_PATHS.files]: {
    answer: answerFiles,
    schema: vaultFilesRequestSchema,
    usage: `Send {"ref": <sha>, "paths": [1..${String(VAULT_FILES_MAX_PATHS)} unique vault-relative paths]}.`,
  },
  [VAULT_API_PATHS.asset]: {
    answer: answerAsset,
    schema: vaultAssetQuerySchema,
    usage: 'Send {"path": <vault-relative path>, "ref": <sha>}, both required.',
  },
};

export const isVaultReadPath = (pathname: string): pathname is VaultReadPath =>
  Object.hasOwn(VAULT_READS, pathname);

export const handleVaultReadRoutes = async <P extends VaultReadPath>(
  request: Request,
  env: Env,
  path: P,
): Promise<Response> => {
  if (request.method !== "POST") {
    return refuse("bad-request", "Send the read as a POST with a JSON body.");
  }

  const db = createDb(env.DB);
  const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
  if (verified === null) {
    return refuseNoDeviceCredential();
  }

  if (!(await spendDeviceBudget(env, db, "vaultRead", verified.deviceId))) {
    return refuse("rate-limited", "Too many vault reads from this device — wait a minute.");
  }

  const route = VAULT_READS[path];
  const query = route.schema.safeParse(await request.json().catch(() => null));
  if (!query.success) {
    return refuse("bad-request", route.usage);
  }

  const repo = vaultRepoName(verified.userId);
  // getByName on the repo namespace creates a cell, and a BYO-remote phone polls the unpinned tree
  // forever; the registry answers "no vault" without materializing one per poll. A read pinned to
  // a ref skips it, since only a read that passed it answers a ref.
  if (query.data.ref === undefined) {
    const info = await vaultRegistry(env).get(repo);
    if (info === null) {
      return refuse("not-found", "This account has no hosted vault yet.");
    }
  }
  return await route.answer(env.REPO.getByName(repo), query.data, env, repo);
};
