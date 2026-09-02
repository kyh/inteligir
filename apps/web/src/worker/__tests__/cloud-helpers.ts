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

export const ORIGIN = "https://inteligir-web.workers.dev";
const PASSWORD = "test-password-1234";

let inviteCounter = 0;

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

const sessionUserSchema = z.looseObject({ user: z.looseObject({ id: z.string() }) });

// ask before a test deletes the account; afterwards the session no longer answers
export async function userIdOf(bearer: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
    headers: sessionHeaders(bearer),
  });
  const body = sessionUserSchema.safeParse(await response.json());
  if (!body.success) throw new Error("no session for that bearer");
  return body.data.user.id;
}

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
    const { data } = message;
    if (data instanceof ArrayBuffer) return;
    frames.push(syncPingSchema.parse(JSON.parse(data)));
  });
  return { frames, socket };
}

// pings cross the in-process socket pair a macrotask after the push, so frames must be awaited
export async function awaitFrames(
  socket: { frames: SyncPing[] },
  expected: readonly SyncPing[],
): Promise<void> {
  await vi.waitFor(() => expect(socket.frames).toEqual(expected));
}
