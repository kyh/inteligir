import { VAULT_GIT_MAX_PUSH_BYTES, VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import type { Registry } from "durable-git";
import { declaredLength } from "../cloud-http";
import { createDb } from "../db/client";
import { deviceCredentialFromHeader, verifyDeviceCredentialValue } from "../device/device-auth";
import { spendDeviceBudget } from "../rate-limit";
import { receiveIntoVaultCell, sendToVaultCell } from "./receive-pack";
import type { VaultCellRoute, VaultPushLimit } from "./receive-pack";
import { treeListingPrefix } from "./tree-listing";

// The URL is identity-free: the repo is named from the verified credential. Verification lives
// here, not in dgit's Basic-only hook; receive-pack.ts is the door the verified request takes.

const PROTOCOL_ROUTES = new Map<string, VaultCellRoute>([
  ["GET /info/refs", "/info/refs"],
  ["POST /git-upload-pack", "/git-upload-pack"],
  ["POST /git-receive-pack", "/git-receive-pack"],
]);

// mirrors durable-git's negotiation-body ceiling, enforced on the declared length because the
// library buffers an undeclared (chunked) body whole
const MAX_UPLOAD_PACK_BYTES = 16 * 1024 * 1024;

// plain text for a person running git by hand; the engine reads the status alone, since git
// reports a failed push's status and drops its body. the storage cap answers 507, not the push
// cap's 413: a vault with no room refuses any history, where a smaller one passes a 413.
const overLimit = (limit: VaultPushLimit): Response =>
  limit === "storage"
    ? new Response("the hosted vault is full; it keeps every version, history included\n", {
        status: 507,
      })
    : new Response(
        `push exceeds the hosted vault's ${String(VAULT_GIT_MAX_PUSH_BYTES / (1024 * 1024))} MiB limit\n`,
        { status: 413 },
      );

// dgit refuses repo names outside this set, and the userId is embedded in the name
const REPO_NAME_SAFE = /^[A-Za-z0-9._-]+$/u;

// also the read routes' address (read-routes.ts): one derivation, so push and read cannot name different repos
export const vaultRepoName = (userId: string): string => `vault-${userId}`;

// one spelling: reads consult it and deletion removes from it
export const vaultRegistry = (env: Env): DurableObjectStub<Registry> =>
  env.REGISTRY.getByName("registry");

// plain text plus a Basic challenge: the challenge is what makes a stock git client prompt
const unauthorized = (): Response =>
  new Response("auth required\n", {
    headers: { "www-authenticate": 'Basic realm="inteligir vault"' },
    status: 401,
  });

export const handleVaultGitRemote = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  const route = PROTOCOL_ROUTES.get(
    `${request.method} ${url.pathname.slice(VAULT_GIT_PATH.length)}`,
  );
  if (route === undefined) {
    return new Response("not found\n", { status: 404 });
  }

  const db = createDb(env.DB);
  const credential = deviceCredentialFromHeader(request.headers.get("authorization"));
  const verified = credential === null ? null : await verifyDeviceCredentialValue(db, credential);
  if (verified === null) {
    return unauthorized();
  }

  if (!(await spendDeviceBudget(env, db, "vaultGit", verified.deviceId))) {
    // plain text: a JSON envelope in a git client's stderr is noise
    return new Response("too many requests\n", { status: 429 });
  }

  const repo = vaultRepoName(verified.userId);
  if (!REPO_NAME_SAFE.test(verified.userId)) {
    return new Response("internal error\n", { status: 500 });
  }

  const door = {
    ctx,
    deviceId: verified.deviceId,
    env,
    registry: vaultRegistry(env),
    repo,
    userId: verified.userId,
  };
  if (route === "/git-receive-pack") {
    const answer = await receiveIntoVaultCell(door, {
      body: request.body,
      headers: request.headers,
      url: request.url,
    });
    return answer.kind === "answered" ? answer.response : overLimit(answer.limit);
  }

  if (route === "/git-upload-pack") {
    const declared = declaredLength(request.headers);
    if (!Number.isFinite(declared) || declared > MAX_UPLOAD_PACK_BYTES) {
      return new Response("upload-pack body must declare a length within the ceiling\n", {
        status: 413,
      });
    }
  }
  return await sendToVaultCell(door, route, {
    body: request.body,
    headers: request.headers,
    method: request.method,
    url: request.url,
  });
};

// durable-git's own R2 layout, private to it and copied here: pushed packs, then clone-cache packs
// per ref version. vault-git.test.ts fills both before an account deletion, so a drift fails there
export const packCachePrefixes = (repo: string): readonly string[] => [
  `raw/${repo}/`,
  `pack/${repo}/`,
];

// A non-OK answer throws so beforeDelete aborts and the account survives to retry; a never-pushed
// repo wipes empty tables, so it is idempotent. Residual: a push whose pack is still uploading can
// recreate the repo after the wipe (dgit has no tombstone), and a tree read still walking can
// rewrite its listing slot; either orphan is unreachable, since every credential that could name it
// is revoked.
export const deleteVaultGitRepo = async (env: Env, userId: string): Promise<void> => {
  const repo = vaultRepoName(userId);
  // not gated on the registry: a purge must not trust an index, or a lost registry row leaves the bytes alive
  const response = await env.REPO.getByName(repo).fetch("https://vault-git/", {
    headers: { "x-repo": repo },
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`vault git repo delete failed: ${response.status}`);
  }
  // dgit's own R2 purge logs a failure and answers ok, which a deletion hook cannot trust; a throw aborts the deletion
  for (const prefix of [...packCachePrefixes(repo), treeListingPrefix(repo)]) {
    let cursor: string | undefined;
    do {
      const listing = await env.PACK_CACHE.list(
        cursor === undefined ? { prefix } : { cursor, prefix },
      );
      if (listing.objects.length > 0) {
        await env.PACK_CACHE.delete(listing.objects.map((object) => object.key));
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor !== undefined);
  }
  await vaultRegistry(env).remove(repo);
};
