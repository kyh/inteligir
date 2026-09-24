import { VAULT_GIT_MAX_PUSH_BYTES, VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { createDurableGit } from "durable-git";
import type { Registry } from "durable-git";
import { createDb } from "../db/client";
import { deviceCredentialFromHeader, verifyDeviceCredentialValue } from "../device/device-auth";
import { spendDeviceBudget } from "../rate-limit";
import { pingVaultAdvanced } from "../sync/routes";
import { treeListingPrefix } from "./tree-listing";

// The URL is identity-free: the repo name is derived from the verified credential and rewritten
// into the path, keeping the userId's case so `user:<userId>` round-trips for the push ping.
// Verification lives here, not in dgit's Basic-only hook; its authorize stays as defense-in-depth
// over a marker header. The ping does not use dgit's onPush, which cannot name the pushing device.

// stamped after verification; any inbound copy is stripped first
const AUTHORIZED_HEADER = "x-vault-authorized";

const PROTOCOL_ROUTES = new Set([
  "GET /info/refs",
  "POST /git-upload-pack",
  "POST /git-receive-pack",
]);

// mirrors durable-git's negotiation-body ceiling, enforced on the declared length because the
// library buffers an undeclared (chunked) body whole
const MAX_UPLOAD_PACK_BYTES = 16 * 1024 * 1024;

// NaN when undeclared, never 0: Number("") is 0, so an absent header would read as a tiny body
const declaredLength = (request: Request): number => {
  const header = request.headers.get("content-length") ?? "";
  return /^\d+$/u.test(header) ? Number(header) : Number.NaN;
};

// plain text for a person running git by hand; the engine reads the status alone, since git
// reports a failed push's status and drops its body
const pushTooLarge = (): Response =>
  new Response(
    `push exceeds the hosted vault's ${String(VAULT_GIT_MAX_PUSH_BYTES / (1024 * 1024))} MiB limit\n`,
    { status: 413 },
  );

// git streams every push past its 1 MiB postBuffer with no declared length, so the cap is counted
// in flight. the body ends at the cap rather than erroring: durable-git fails the cut pack's
// checksum and moves no ref either way, and an errored body only reaches the runtime's own pump
// to the repo cell, where it surfaces as an uncaught rejection.
interface CappedBody {
  body: ReadableStream<Uint8Array>;
  exceeded: () => boolean;
}

const cappedBody = (body: ReadableStream<Uint8Array>): CappedBody => {
  const reader = body.getReader();
  let received = 0;
  let exceeded = false;
  const counted = new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      received += value.byteLength;
      if (received > VAULT_GIT_MAX_PUSH_BYTES) {
        exceeded = true;
        await reader.cancel();
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
  });
  return { body: counted, exceeded: () => exceeded };
};

// dgit refuses repo names outside this set, and the userId is embedded in the name
const REPO_NAME_SAFE = /^[A-Za-z0-9._-]+$/u;

// also the read routes' address (read-routes.ts): one derivation, so push and read cannot name different repos
export const vaultRepoName = (userId: string): string => `vault-${userId}`;

// one spelling: reads consult it and deletion removes from it
export const vaultRegistry = (env: Env): DurableObjectStub<Registry> =>
  env.REGISTRY.getByName("registry");

// dgit suppresses a registry upsert failure ("next push heals"), but the read routes gate on the
// registry, so a suppressed failure after the first push leaves the vault invisible; idempotent
const upsertVaultRegistry = async (env: Env, repo: string, idle: number): Promise<void> => {
  try {
    await vaultRegistry(env).upsert(repo, idle);
  } catch {
    // dgit's next-push-heals fallback still stands
  }
};

const handler = createDurableGit<Env>({
  authorize: (ctx) => ctx.request.headers.get(AUTHORIZED_HEADER) === ctx.repo,
  ui: false,
});

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
  const sub = url.pathname.slice(VAULT_GIT_PATH.length);
  if (!PROTOCOL_ROUTES.has(`${request.method} ${sub}`)) {
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

  if (sub === "/git-upload-pack") {
    const declared = declaredLength(request);
    if (!Number.isFinite(declared) || declared > MAX_UPLOAD_PACK_BYTES) {
      return new Response("upload-pack body must declare a length within the ceiling\n", {
        status: 413,
      });
    }
  }

  let { body } = request;
  let capped: CappedBody | null = null;
  if (sub === "/git-receive-pack") {
    const declared = declaredLength(request);
    if (declared > VAULT_GIT_MAX_PUSH_BYTES) {
      return pushTooLarge();
    }
    // a declared length frames the body, so only an undeclared one can run past it
    if (Number.isNaN(declared) && body !== null) {
      capped = cappedBody(body);
      ({ body } = capped);
    }
  }

  const target = new URL(request.url);
  target.pathname = `/${repo}.git${sub}`;
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(AUTHORIZED_HEADER, repo);

  const response = await handler.fetch(
    new Request(target, { body, headers, method: request.method }),
    env,
    ctx,
  );

  if (sub === "/git-receive-pack" && response.ok && response.headers.get("x-changed") === "1") {
    ctx.waitUntil(pingVaultAdvanced(env, verified.userId, verified.deviceId));
    const idle = Number(response.headers.get("x-commit-time")) || Date.now();
    ctx.waitUntil(upsertVaultRegistry(env, repo, idle));
  }
  // durable-git answers a cut pack 200 with every ref refused; the cap is the reason
  return capped?.exceeded() === true ? pushTooLarge() : response;
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
