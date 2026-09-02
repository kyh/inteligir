import {
  generatePkceVerifier,
  mintPairingCodeResponseSchema,
  pkceChallengeS256,
  redeemDeviceResponseSchema,
} from "@repo/api/cloud/pairing/pairing-schema";
import { syncPingSchema, type SyncPing } from "@repo/api/cloud/sync/sync-ws";
import { env, SELF } from "cloudflare:test";
import { expect, vi } from "vitest";
import { z } from "zod";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

// Shared setup for the cloud suites: a real account through the invite gate,
// a real device through the pairing flow — every step is the production path.

export const ORIGIN = "https://inteligir-web.workers.dev";
const PASSWORD = "test-password-1234";

let inviteCounter = 0;

/** Create an account and hand back its session BEARER (what a native caller
 * holds; the browser's cookie is the same session). */
export async function signUpUser(email: string): Promise<{ bearer: string; password: string }> {
  const code = `CLOUD-TEST-${++inviteCounter}`;
  await createDb(env.DB).insert(inviteCode).values({ code });
  const response = await SELF.fetch(`${ORIGIN}/v1/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name: "Cloud Tester", email, password: PASSWORD, inviteCode: code }),
  });
  expect(response.status).toBe(200);
  const bearer = response.headers.get("set-auth-token");
  expect(bearer).not.toBeNull();
  return { bearer: bearer ?? "", password: PASSWORD };
}

export function sessionHeaders(bearer: string) {
  return { authorization: `Bearer ${bearer}`, origin: ORIGIN };
}

/** Better Auth's `get-session` answer, read for the one field these tests
 *  need. A signed-out session answers `null`, which fails the parse. */
const sessionUserSchema = z.looseObject({ user: z.looseObject({ id: z.string() }) });

/** The signed-in user's id — what names their ThreadSyncDO. Ask BEFORE any
 * test deletes the account; afterwards the session no longer answers. */
export async function userIdOf(bearer: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
    headers: sessionHeaders(bearer),
  });
  const body = sessionUserSchema.safeParse(await response.json());
  if (!body.success) throw new Error("no session for that bearer");
  return body.data.user.id;
}

/** Mint a code bound to a PKCE challenge — the approve page's act. Returns both
 *  the code and the verifier the redeem will have to present. */
export async function mintCode(bearer: string): Promise<{ code: string; verifier: string }> {
  const verifier = generatePkceVerifier();
  const challenge = await pkceChallengeS256(verifier);
  const response = await SELF.fetch(`${ORIGIN}/v1/device/code`, {
    method: "POST",
    headers: { ...sessionHeaders(bearer), "content-type": "application/json" },
    body: JSON.stringify({ challenge, challengeMethod: "S256" }),
  });
  expect(response.status).toBe(200);
  return { code: mintPairingCodeResponseSchema.parse(await response.json()).code, verifier };
}

export async function pairDevice(
  bearer: string,
  deviceName: string,
): Promise<{ deviceId: string; credential: string }> {
  const { code, verifier } = await mintCode(bearer);
  const response = await SELF.fetch(`${ORIGIN}/v1/device/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName, verifier }),
  });
  expect(response.status).toBe(200);
  return redeemDeviceResponseSchema.parse(await response.json());
}

export function deviceHeaders(credential: string) {
  return { authorization: `Bearer ${credential}` };
}

/** Open the invalidation socket and collect its frames. */
export async function openSocket(
  credential: string,
  platform: string,
): Promise<{ frames: SyncPing[]; socket: WebSocket }> {
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws?platform=${platform}`, {
    headers: { ...deviceHeaders(credential), upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("no websocket on the 101");
  socket.accept();
  const frames: SyncPing[] = [];
  socket.addEventListener("message", (message) => {
    // Keepalive frames are text; a binary frame is not one of them.
    const { data } = message;
    if (data instanceof ArrayBuffer) return;
    frames.push(syncPingSchema.parse(JSON.parse(data)));
  });
  return { frames, socket };
}

/** The pings are sent inside the push's own invocation and cross the
 *  in-process pair a macrotask later, so a socket's frames are awaited rather
 *  than read straight after the push. Exact: a frame that must NOT arrive is
 *  proven absent by a later frame that did. */
export async function awaitFrames(
  socket: { frames: SyncPing[] },
  expected: readonly SyncPing[],
): Promise<void> {
  await vi.waitFor(() => expect(socket.frames).toEqual(expected));
}
