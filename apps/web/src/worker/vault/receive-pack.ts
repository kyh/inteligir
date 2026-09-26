import { createDurableGit } from "durable-git";
import type { Registry } from "durable-git";
import { pingVaultAdvanced } from "../sync/routes";
import { concatBytes } from "./git-objects";

// The one door to a user's repo cell, for a client's request and the Worker's own push alike, so
// both take the cell's ref CAS and both run the after-push effects. The caller names the repo from
// a verified credential; it is rewritten into the path here, keeping the userId's case so
// `user:<userId>` round-trips for the push ping. dgit's authorize stays as defense-in-depth over a
// marker header only this door stamps. The ping does not use dgit's onPush, which cannot name the
// pushing device.

// set on every request, so an inbound copy never survives
const AUTHORIZED_HEADER = "x-vault-authorized";

const handler = createDurableGit<Env>({
  authorize: (ctx) => ctx.request.headers.get(AUTHORIZED_HEADER) === ctx.repo,
  ui: false,
});

export type VaultCellRoute = "/info/refs" | "/git-upload-pack" | "/git-receive-pack";

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

export const sendToVaultCell = async (
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
  const response = await sendToVaultCell(door, "/git-receive-pack", {
    body: receivePackBody(push),
    headers: new Headers({ "content-type": "application/x-git-receive-pack-request" }),
    method: "POST",
    url: CELL_ORIGIN,
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: "refused", reason: `the repo cell answered ${String(response.status)}` };
  }
  return readReportStatus(new Uint8Array(await response.arrayBuffer()), push.ref);
};
