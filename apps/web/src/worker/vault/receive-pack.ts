import { VAULT_GIT_MAX_PUSH_BYTES } from "@repo/api/cloud/vault/vault-git";
import { createDurableGit } from "durable-git";
import type { Registry } from "durable-git";
import { declaredLength } from "../cloud-http";
import { pingVaultAdvanced } from "../sync/routes";
import { concatBytes } from "./git-objects";

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
    door.ctx.waitUntil(pingVaultAdvanced(door.env, door.userId, door.deviceId));
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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const FLUSH_PKT = encoder.encode("0000");

export const pktLine = (text: string): Uint8Array => {
  const payload = encoder.encode(text);
  const length = (payload.length + 4).toString(16).padStart(4, "0");
  return concatBytes([encoder.encode(length), payload]);
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

export type VaultPushOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "ref-moved" }
  | { readonly kind: "full" }
  | { readonly kind: "refused"; readonly reason: string };

const PKT_LENGTH = /^[0-9a-f]{4}$/iu;

// the lines up to the flush; null when a frame is malformed or no flush ends them
const readPktLines = (bytes: Uint8Array): string[] | null => {
  const lines: string[] = [];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const prefix = decoder.decode(bytes.subarray(at, at + 4));
    if (!PKT_LENGTH.test(prefix)) {
      return null;
    }
    const length = Number.parseInt(prefix, 16);
    if (length === 0) {
      return lines;
    }
    if (length < 4 || at + length > bytes.length) {
      return null;
    }
    lines.push(decoder.decode(bytes.subarray(at + 4, at + length)).replace(/\n$/u, ""));
    at += length;
  }
  return null;
};

// durable-git answers a CAS that lost to another push `ng <ref> fetch first`, as git does
const readReportStatus = (bytes: Uint8Array, ref: string): VaultPushOutcome => {
  const lines = readPktLines(bytes);
  if (lines === null) {
    return { kind: "refused", reason: "unreadable report-status" };
  }
  const [unpack, ...statuses] = lines;
  if (unpack !== "unpack ok") {
    return { kind: "refused", reason: unpack ?? "empty report-status" };
  }
  const refused = `ng ${ref} `;
  for (const status of statuses) {
    if (status === `ok ${ref}`) {
      return { kind: "applied" };
    }
    if (status.startsWith(refused)) {
      const reason = status.slice(refused.length);
      return reason === "fetch first" ? { kind: "ref-moved" } : { kind: "refused", reason };
    }
  }
  return { kind: "refused", reason: `no status for ${ref}` };
};

// the handler reads the path alone, so any origin serves
const CELL_ORIGIN = "https://vault-cell/";

export const pushVaultPack = async (
  door: VaultCellDoor,
  push: VaultPackPush,
): Promise<VaultPushOutcome> => {
  const answer = await receiveIntoVaultCell(door, {
    body: receivePackBody(push),
    headers: new Headers({ "content-type": "application/x-git-receive-pack-request" }),
    url: CELL_ORIGIN,
  });
  if (answer.kind === "over-limit") {
    return answer.limit === "storage"
      ? { kind: "full" }
      : { kind: "refused", reason: "the pack is over the push cap" };
  }
  const { response } = answer;
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: "refused", reason: `the repo cell answered ${String(response.status)}` };
  }
  return readReportStatus(new Uint8Array(await response.arrayBuffer()), push.ref);
};
