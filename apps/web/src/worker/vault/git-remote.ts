import { VAULT_GIT_PATH } from "@repo/api/cloud/vault/vault-git";
import { createDurableGit, type Registry } from "durable-git";
import { createDb } from "../db/client";
import { deviceCredentialFromHeader, verifyDeviceCredentialValue } from "../device/device-auth";
import { allowInWindow, deviceRateKey, type RateWindow } from "../rate-limit";
import { pingVaultAdvanced } from "../sync/routes";

// The URL is identity-free: the repo name is derived from the verified credential and rewritten
// into the path, keeping the userId's case so `user:<userId>` round-trips for the push ping.
// Verification lives here, not in dgit's Basic-only hook; its authorize stays as defense-in-depth
// over a marker header. The ping does not use dgit's onPush, which cannot name the pushing device.

// stamped after verification; any inbound copy is stripped first
const AUTHORIZED_HEADER = "x-vault-authorized";

// set from the worst legitimate minute: 20 devices, every push pings the others, and a pinged
// device syncs at once, so one device can owe ~100 requests; a ceiling near that refuses real sync
const VAULT_GIT_WINDOW: RateWindow = { max: 600, windowMs: 60_000 };

const PROTOCOL_ROUTES = new Set([
  "GET /info/refs",
  "POST /git-upload-pack",
  "POST /git-receive-pack",
]);

// mirrors durable-git's negotiation-body ceiling, enforced on the declared length because the
// library buffers an undeclared (chunked) body whole. parseInt, not Number: Number(null) is 0,
// so an absent header would read as a tiny declared body
const MAX_UPLOAD_PACK_BYTES = 16 * 1024 * 1024;

// dgit refuses repo names outside this set, and the userId is embedded in the name
const REPO_NAME_SAFE = /^[A-Za-z0-9._-]+$/;

// also the read routes' address (read-routes.ts): one derivation, so push and read cannot name different repos
export function vaultRepoName(userId: string): string {
  return `vault-${userId}`;
}

// one spelling: reads consult it and deletion removes from it
export function vaultRegistry(env: Env): DurableObjectStub<Registry> {
  return env.REGISTRY.getByName("registry");
}

const handler = createDurableGit<Env>({
  ui: false,
  authorize: (ctx) => ctx.request.headers.get(AUTHORIZED_HEADER) === ctx.repo,
});

// plain text plus a Basic challenge: the challenge is what makes a stock git client prompt
function unauthorized(): Response {
  return new Response("auth required\n", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="inteligir vault"' },
  });
}

export async function handleVaultGitRemote(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const sub = url.pathname.slice(VAULT_GIT_PATH.length);
  if (!PROTOCOL_ROUTES.has(`${request.method} ${sub}`)) {
    return new Response("not found\n", { status: 404 });
  }

  const db = createDb(env.DB);
  const credential = deviceCredentialFromHeader(request.headers.get("authorization"));
  const verified = credential === null ? null : await verifyDeviceCredentialValue(db, credential);
  if (verified === null) return unauthorized();

  if (
    !(await allowInWindow(env, db, deviceRateKey("vaultGit", verified.deviceId), VAULT_GIT_WINDOW))
  ) {
    // plain text: a JSON envelope in a git client's stderr is noise
    return new Response("too many requests\n", { status: 429 });
  }

  const repo = vaultRepoName(verified.userId);
  if (!REPO_NAME_SAFE.test(verified.userId)) {
    return new Response("internal error\n", { status: 500 });
  }

  if (sub === "/git-upload-pack") {
    const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (!Number.isFinite(declared) || declared > MAX_UPLOAD_PACK_BYTES) {
      return new Response("upload-pack body must declare a length within the ceiling\n", {
        status: 413,
      });
    }
  }

  const target = new URL(request.url);
  target.pathname = `/${repo}.git${sub}`;
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(AUTHORIZED_HEADER, repo);

  const response = await handler.fetch(
    new Request(target, { method: request.method, headers, body: request.body }),
    env,
    ctx,
  );

  if (sub === "/git-receive-pack" && response.ok && response.headers.get("x-changed") === "1") {
    ctx.waitUntil(pingVaultAdvanced(env, verified.userId, verified.deviceId));
    // dgit suppresses a registry upsert failure ("next push heals"), but the read routes gate on the
    // registry, so a suppressed failure after the first push leaves the vault invisible; idempotent
    const idle = Number(response.headers.get("x-commit-time")) || Date.now();
    ctx.waitUntil(
      Promise.resolve(vaultRegistry(env).upsert(repo, idle)).catch(() => {
        // dgit's next-push-heals fallback still stands
      }),
    );
  }
  return response;
}

// A non-OK answer throws so beforeDelete aborts and the account survives to retry; a never-pushed
// repo wipes empty tables, so it is idempotent. Residual: a push whose pack is still uploading can
// recreate the repo after the wipe; dgit has no tombstone, and the orphan is unreachable since
// every credential that could name it is revoked.
export async function deleteVaultGitRepo(env: Env, userId: string): Promise<void> {
  const repo = vaultRepoName(userId);
  // not gated on the registry: a purge must not trust an index, or a lost registry row leaves the bytes alive
  const response = await env.REPO.getByName(repo).fetch("https://vault-git/", {
    method: "DELETE",
    headers: { "x-repo": repo },
  });
  if (!response.ok) {
    throw new Error(`vault git repo delete failed: ${response.status}`);
  }
  // dgit's own R2 purge logs a failure and answers ok, which a deletion hook cannot trust; a throw aborts the deletion
  for (const prefix of [`raw/${repo}/`, `pack/${repo}/`]) {
    let cursor: string | undefined;
    do {
      const listing = await env.PACK_CACHE.list(
        cursor === undefined ? { prefix } : { prefix, cursor },
      );
      if (listing.objects.length > 0) {
        await env.PACK_CACHE.delete(listing.objects.map((object) => object.key));
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor !== undefined);
  }
  await vaultRegistry(env).remove(repo);
}
