import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/contract/cloud/vault/vault-git";
import { createDurableGit } from "durable-git";
import type { Registry } from "durable-git";
import { declaredLength } from "../cloud-http";
import { libraryCell } from "../library/library-cell";
import { errorFields } from "../log";
import { concatBytes } from "./git-objects";
import { FLUSH_PKT, pktLine } from "./pkt-line";

// The one door to a user's repo cell, for a client's request and the Worker's own push alike, so
// both take the cell's ref CAS, both run the after-push effects and both meet the one quota gate.
// The caller names the repo from a verified credential; it is rewritten into the path here,
// keeping the userId's case so `user:<userId>` round-trips for the push ping. dgit's authorize
// stays as defense-in-depth over a marker header only this door stamps. The ping does not use
// dgit's onPush, which cannot name the pushing device.

// set on every request, so an inbound copy never survives
const AUTHORIZED_HEADER = "x-vault-authorized";

const handler = createDurableGit<Env>({
  authorize: (ctx) => ctx.request.headers.get(AUTHORIZED_HEADER) === ctx.repo,
  ui: false,
});

type VaultReadRoute = "/info/refs" | "/git-upload-pack";

export type VaultCellRoute = VaultReadRoute | "/git-receive-pack";

export interface VaultCellDoor {
  readonly env: Env;
  readonly ctx: ExecutionContext;
  readonly repo: string;
  readonly registry: DurableObjectStub<Registry>;
  readonly userId: string;
  // the device the push ping skips
  readonly deviceId: string;
}

export interface VaultCellRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: BodyInit | null;
}

// dgit suppresses a registry upsert failure ("next push heals"), but the read routes gate on the
// registry, so a suppressed failure after the first push leaves the vault invisible; idempotent
const upsertRegistry = async (door: VaultCellDoor, idle: number): Promise<void> => {
  try {
    await door.registry.upsert(door.repo, idle);
  } catch {
    // dgit's next-push-heals fallback still stands
  }
};

// best-effort: a lost ping costs the other devices staleness until their next poll
const pingVaultMoved = async (door: VaultCellDoor): Promise<void> => {
  try {
    await libraryCell(door.ctx.exports, door.userId).vaultMoved(door.deviceId);
  } catch (error) {
    console.warn({ event: "vault-ping-failed", ...errorFields(error) });
  }
};

const fetchCell = async (
  door: VaultCellDoor,
  route: VaultCellRoute,
  request: VaultCellRequest,
): Promise<Response> => {
  const target = new URL(request.url);
  target.pathname = `/${door.repo}.git${route}`;
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set(AUTHORIZED_HEADER, door.repo);

  const response = await handler.fetch(
    new Request(target, { body: request.body, headers, method: request.method }),
    door.env,
    door.ctx,
  );

  if (route === "/git-receive-pack" && response.ok && response.headers.get("x-changed") === "1") {
    door.ctx.waitUntil(pingVaultMoved(door));
    const idle = Number(response.headers.get("x-commit-time")) || Date.now();
    door.ctx.waitUntil(upsertRegistry(door, idle));
  }
  return response;
};

// never refused for size: a full vault still clones and pulls
export const sendToVaultCell = async (
  door: VaultCellDoor,
  route: VaultReadRoute,
  request: VaultCellRequest,
): Promise<Response> => await fetchCell(door, route, request);

const STORAGE_CAP = /^[1-9]\d*$/u;

// what one account's hosted vault may store, history included
export const vaultStorageCap = (env: Env): number => {
  const cap = env.VAULT_STORAGE_CAP_BYTES;
  if (!STORAGE_CAP.test(cap)) {
    throw new Error(`VAULT_STORAGE_CAP_BYTES must be a whole number of bytes, not "${cap}"`);
  }
  return Number(cap);
};

// git streams every push past its 1 MiB postBuffer with no declared length, so the limit is
// counted in flight. the body ends at the limit rather than erroring: durable-git fails the cut
// pack's checksum and moves no ref either way, and an errored body only reaches the runtime's own
// pump to the repo cell, where it surfaces as an uncaught rejection.
interface CappedBody {
  body: ReadableStream<Uint8Array>;
  exceeded: () => boolean;
}

const cappedBody = (body: ReadableStream<Uint8Array>, limit: number): CappedBody => {
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
      if (received > limit) {
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

// one push's size, and what the vault stores in all
export type VaultPushLimit = "push-size" | "storage";

export type VaultReceiveAnswer =
  | { readonly kind: "answered"; readonly response: Response }
  | { readonly kind: "over-limit"; readonly limit: VaultPushLimit };

export interface VaultReceiveRequest {
  readonly url: string;
  readonly headers: Headers;
  // a client's push as it streams in, or a pack the Worker built whole
  readonly body: ReadableStream<Uint8Array> | Uint8Array | null;
}

// The cap is on what the cell stores, read before the pack arrives, and a pack may take at most
// what is left. Pushes landing together can each fit and jointly cross it; the next is refused.
export const receiveIntoVaultCell = async (
  door: VaultCellDoor,
  request: VaultReceiveRequest,
): Promise<VaultReceiveAnswer> => {
  const { storedBytes } = await door.env.REPO.getByName(door.repo).usage();
  const remaining = vaultStorageCap(door.env) - storedBytes;
  const unread = async (limit: VaultPushLimit): Promise<VaultReceiveAnswer> => {
    if (request.body instanceof ReadableStream) {
      await request.body.cancel();
    }
    return { kind: "over-limit", limit };
  };
  if (remaining <= 0) {
    return await unread("storage");
  }
  const length =
    request.body instanceof Uint8Array ? request.body.byteLength : declaredLength(request.headers);
  if (length > VAULT_GIT_MAX_PUSH_BYTES) {
    return await unread("push-size");
  }
  if (length > remaining) {
    return await unread("storage");
  }

  let { body } = request;
  let capped: CappedBody | null = null;
  // a declared length frames the body, so only an undeclared one can run past it
  if (body instanceof ReadableStream && Number.isNaN(length)) {
    capped = cappedBody(body, Math.min(VAULT_GIT_MAX_PUSH_BYTES, remaining));
    ({ body } = capped);
  }
  const response = await fetchCell(door, "/git-receive-pack", {
    body,
    headers: request.headers,
    method: "POST",
    url: request.url,
  });
  // durable-git answers a cut pack 200 with every ref refused; the tighter limit is the reason
  if (capped?.exceeded() === true) {
    await response.body?.cancel();
    return {
      kind: "over-limit",
      limit: remaining < VAULT_GIT_MAX_PUSH_BYTES ? "storage" : "push-size",
    };
  }
  return { kind: "answered", response };
};

export interface VaultPackPush {
  readonly ref: string;
  // what the ref must still hold for the push to land
  readonly old: string;
  readonly next: string;
  readonly pack: Uint8Array;
}

// report-status and no side band, so the answer is bare pkt-lines
export const receivePackBody = ({ next, old, pack, ref }: VaultPackPush): Uint8Array =>
  concatBytes([pktLine(`${old} ${next} ${ref}\0report-status`), FLUSH_PKT, pack]);
