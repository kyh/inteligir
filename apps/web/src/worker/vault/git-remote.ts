import { VAULT_GIT_MAX_PUSH_BYTES, VAULT_GIT_PATH } from "@repo/contract/cloud/vault/vault-git";
import { declaredLength } from "../cloud-http";
import { createDb } from "../db/client";
import { deviceCredentialFromHeader, verifyDeviceCredentialValue } from "../device/device-auth";
import { spendDeviceBudget } from "../rate-limit";
import { receiveIntoVaultCell, sendToVaultCell } from "./receive-pack";
import type { VaultCellRoute, VaultPushLimit } from "./receive-pack";
import { vaultRegistry, vaultRepoName } from "./vault-repo";

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
