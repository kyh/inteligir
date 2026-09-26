import { bytesFromBase64 } from "@repo/api/cloud/bytes";
import { CLOUD_ERROR_STATUS, cloudError } from "@repo/api/cloud/errors";
import {
  VAULT_COMMIT_MAX_BYTES,
  VAULT_COMMIT_MAX_CHANGES,
  vaultChangePaths,
  vaultCommitRequestSchema,
} from "@repo/api/cloud/vault/vault-commit-schema";
import type {
  VaultChangeRequest,
  VaultCommitResponse,
  VaultConflictAnswer,
} from "@repo/api/cloud/vault/vault-commit-schema";
import {
  assetMediaType,
  VAULT_ASSET_MAX_BYTES,
  VAULT_FILE_MAX_BYTES,
} from "@repo/api/cloud/vault/vault-schema";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import { spendDeviceBudget } from "../rate-limit";
import { commitChanges } from "./commit-changes";
import type { CommitChangesResult, VaultChange } from "./commit-changes";
import { declaredLength, vaultRegistry, vaultRepoName } from "./git-remote";
import { pushVaultPack } from "./receive-pack";

// The Worker is a CAS and never merges: a conflict answers what the head holds, and the device
// reconciles and sends one new set.

// a queued edit is dated by the device that made it, but a phone's clock is the user's to set, so
// the date is held to the past month and never the future
const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;

// under the u flag a pair is one code point, so only a lone half matches; encoded, it would land
// as U+FFFD, a silent edit to the note
const LONE_SURROGATE = /\p{Cs}/u;

const encoder = new TextEncoder();

type Decoded =
  | { readonly kind: "change"; readonly change: VaultChange }
  | { readonly kind: "refused"; readonly response: Response };

const refusedWith = (response: Response): Decoded => ({ kind: "refused", response });

const decodeChange = (change: VaultChangeRequest): Decoded => {
  if (vaultChangePaths(change).some((path) => LONE_SURROGATE.test(path))) {
    return refusedWith(refuse("bad-request", "A path with a lone surrogate is not UTF-8."));
  }
  if (change.op !== "put") {
    return { change, kind: "change" };
  }
  const { base, content, path } = change;
  if (content.encoding === "utf-8") {
    if (LONE_SURROGATE.test(content.text)) {
      return refusedWith(
        refuse("bad-request", `${path}: text with a lone surrogate is not UTF-8.`),
      );
    }
    const bytes = encoder.encode(content.text);
    if (bytes.length > VAULT_FILE_MAX_BYTES) {
      return refusedWith(
        refuse(
          "file-too-large",
          `${path}: notes over ${String(VAULT_FILE_MAX_BYTES)} bytes do not cross this wire.`,
        ),
      );
    }
    return { change: { base, bytes, op: "put", path }, kind: "change" };
  }
  if (assetMediaType(path) === null) {
    return refusedWith(refuse("bad-request", `${path}: only an image path takes base64 content.`));
  }
  const bytes = bytesFromBase64(content.data);
  if (bytes.length > VAULT_ASSET_MAX_BYTES) {
    return refusedWith(
      refuse(
        "file-too-large",
        `${path}: attachments over ${String(VAULT_ASSET_MAX_BYTES)} bytes do not cross this wire.`,
      ),
    );
  }
  return { change: { base, bytes, op: "put", path }, kind: "change" };
};

const answer = (result: CommitChangesResult): Response => {
  switch (result.kind) {
    case "committed": {
      const body: VaultCommitResponse = { commit: result.commit, results: [...result.results] };
      return Response.json(body);
    }
    case "conflict": {
      const body: VaultConflictAnswer = {
        ...cloudError(
          "vault-conflict",
          "The vault changed under this change set; none of it landed.",
        ),
        conflict: { conflicts: [...result.conflicts], head: result.head },
      };
      return Response.json(body, { status: CLOUD_ERROR_STATUS["vault-conflict"] });
    }
    case "no-head": {
      return refuse("not-found", "This account has no hosted vault yet.");
    }
    case "exhausted": {
      return refuse("internal", "The vault kept moving under this change set; send it again.");
    }
    // the cell refusing a pack this Worker built is a bug, logged like any other throw
    case "refused": {
      throw new Error(`the repo cell refused a commit: ${result.reason}`);
    }
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
};

export const handleVaultCommitRoute = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  if (request.method !== "POST") {
    return refuse("bad-request", "Send the change set as a POST with a JSON body.");
  }
  // the body is parsed whole, so its length is known before any of it is read
  const declared = declaredLength(request);
  if (Number.isNaN(declared) || declared > VAULT_COMMIT_MAX_BYTES) {
    return refuse(
      "file-too-large",
      `Declare the change set's length; at most ${String(VAULT_COMMIT_MAX_BYTES)} bytes cross this wire.`,
    );
  }

  const db = createDb(env.DB);
  const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
  if (verified === null) {
    return refuse("unauthorized", "No valid device credential.");
  }

  if (!(await spendDeviceBudget(env, db, "vaultWrite", verified.deviceId))) {
    return refuse("rate-limited", "Too many vault writes from this device — wait a minute.");
  }

  // the Mac's first push creates the hosted vault; a write never does, since getByName would
  // materialize a cell, and an account syncing through its own server has none
  const repo = vaultRepoName(verified.userId);
  const registry = vaultRegistry(env);
  if ((await registry.get(repo)) === null) {
    return refuse("not-found", "This account has no hosted vault yet.");
  }

  const body = vaultCommitRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return refuse(
      "bad-request",
      `Send {"changes": [1..${String(VAULT_COMMIT_MAX_CHANGES)} changes, each path named once]}.`,
    );
  }
  const changes: VaultChange[] = [];
  for (const change of body.data.changes) {
    const decoded = decodeChange(change);
    if (decoded.kind === "refused") {
      return decoded.response;
    }
    changes.push(decoded.change);
  }

  const now = Date.now();
  const door = { ctx, deviceId: verified.deviceId, env, registry, repo, userId: verified.userId };
  return answer(
    await commitChanges({
      author: { deviceId: verified.deviceId, deviceName: verified.deviceName },
      authoredAt: Math.min(now, Math.max(now - MAX_BACKDATE_MS, body.data.authoredAt ?? now)),
      changes,
      now,
      send: async (push) => await pushVaultPack(door, push),
      stub: env.REPO.getByName(repo),
    }),
  );
};
