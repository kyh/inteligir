import { createDurableGit } from "durable-git";
import { createDb } from "../db/client";
import { verifyDeviceCredentialValue, type VerifiedDevice } from "../device/device-auth";

// ---------------------------------------------------------------------------
// `/v1/git/vault.git` — the hosted vault remote: one git repo per user, a
// Durable Object speaking smart HTTP through `durable-git`, behind the same
// device credential as every other device route.
//
// The wrapper owns three facts:
//
//   1. THE URL IS IDENTITY-FREE. Every device dials `vault.git`; the real
//      repo name is derived from the VERIFIED credential and rewritten into
//      the path here — the caller never names the repo, the same rule the
//      ThreadSyncDO address follows. The name keeps the userId's case
//      verbatim, because `user:<userId>` must round-trip out of it for the
//      push ping.
//   2. ONLY THE GIT PROTOCOL IS REACHABLE FROM THE WIRE. dgit's JSON API and
//      admin surface stay internal — mobile reads ride our own /cloud rows
//      over the REPO binding's RPC, and deletion is the account hook's call
//      below. What a device credential buys on this path is clone/fetch/push,
//      nothing else.
//   3. THE CREDENTIAL RIDES EITHER CARRIER. The CLI's git sends it as a
//      Bearer header (`http.extraHeader`); a stock git client answers the 401
//      challenge with HTTP Basic, where the password is the credential (the
//      username is ignored). dgit itself parses Basic only, so verification
//      lives here, not in its hook.
//
// dgit's `authorize` is kept as defense-in-depth rather than the gate: the
// wrapper stamps the repo it verified into a marker header (stripped from the
// wire first), and the hook admits exactly that repo. A request reaching the
// handler any other way is refused.
//
// The push ping deliberately does NOT use dgit's `onPush`: that hook knows
// which repo advanced but not which DEVICE pushed, and the pusher must be
// excluded the way `sync` pings exclude theirs. The wrapper verified the
// device, so it observes `x-changed: 1` on the receive-pack response and
// pings the user's ThreadSyncDO itself, off the response path.
// ---------------------------------------------------------------------------

export const VAULT_GIT_PREFIX = "/v1/git/vault.git";

/** Stamped after verification, checked by dgit's authorize hook. Never
 *  accepted from the wire — the wrapper strips any inbound copy. */
const AUTHORIZED_HEADER = "x-vault-authorized";

/** The subpaths git smart HTTP actually uses; everything else 404s. */
const PROTOCOL_ROUTES = new Set([
  "GET /info/refs",
  "POST /git-upload-pack",
  "POST /git-receive-pack",
]);

/** dgit refuses repo names outside this set; the userId is embedded in the
 *  name, so the assumption is checked rather than carried silently. */
const REPO_NAME_SAFE = /^[A-Za-z0-9._-]+$/;

function repoName(userId: string): string {
  return `vault-${userId}`;
}

const handler = createDurableGit<Env>({
  ui: false,
  authorize: (ctx) => ctx.request.headers.get(AUTHORIZED_HEADER) === ctx.repo,
});

/**
 * The credential, from whichever carrier the client used. Basic takes the
 * password field; a client that put the token in the username slot (some
 * helpers do) still verifies, since the other field is empty exactly then.
 */
function credentialFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const [scheme, value, ...rest] = header.split(" ");
  if (value === undefined || rest.length > 0) return null;
  if (scheme?.toLowerCase() === "bearer") return value;
  if (scheme?.toLowerCase() === "basic") {
    let decoded: string;
    try {
      decoded = atob(value);
    } catch {
      return null;
    }
    const colon = decoded.indexOf(":");
    if (colon === -1) return decoded;
    const pass = decoded.slice(colon + 1);
    return pass !== "" ? pass : decoded.slice(0, colon);
  }
  return null;
}

/** Plain text + Basic challenge, not the JSON envelope: this is the git wire,
 *  and the challenge is what makes a stock client prompt. */
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
  const sub = url.pathname.slice(VAULT_GIT_PREFIX.length);
  if (!PROTOCOL_ROUTES.has(`${request.method} ${sub}`)) {
    return new Response("not found\n", { status: 404 });
  }

  const credential = credentialFrom(request);
  const verified =
    credential === null ? null : await verifyDeviceCredentialValue(createDb(env.DB), credential);
  if (verified === null) return unauthorized();

  const repo = repoName(verified.userId);
  if (!REPO_NAME_SAFE.test(verified.userId)) {
    return new Response("internal error\n", { status: 500 });
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
    // Best-effort like the socket sever: a lost ping costs staleness until
    // the next poll, never correctness.
    ctx.waitUntil(sendVaultPing(env, verified).catch(() => {}));
  }
  return response;
}

async function sendVaultPing(env: Env, pusher: VerifiedDevice): Promise<void> {
  const stub = env.THREAD_SYNC.getByName(`user:${pusher.userId}`);
  await stub.fetch("https://thread-sync/vault-ping", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pushingDeviceId: pusher.deviceId }),
  });
}

/**
 * The account-deletion hook's vault half: wipe the user's repo cell (SQLite
 * and its R2 packs — `x-repo` is what keys the purge) and drop the registry
 * row. A non-OK answer throws so the surrounding `beforeDelete` aborts and
 * the account survives to ask again; a repo never pushed to wipes empty
 * tables, so the step is idempotent.
 *
 * The stated residual, mirroring ThreadSyncDO's tombstone rationale: a push
 * whose credential verified before revocation and whose pack is still
 * uploading when this runs can recreate the repo after the wipe. There is no
 * tombstone inside dgit to close that with; the window is one in-flight
 * upload, and the recreated orphan is unreachable — every credential that
 * could name it is already revoked.
 */
export async function deleteVaultGitRepo(env: Env, userId: string): Promise<void> {
  const repo = repoName(userId);
  const response = await env.REPO.getByName(repo).fetch("https://vault-git/", {
    method: "DELETE",
    headers: { "x-repo": repo },
  });
  if (!response.ok) {
    throw new Error(`vault git repo delete failed: ${response.status}`);
  }
  await env.REGISTRY.getByName("registry").remove(repo);
}
