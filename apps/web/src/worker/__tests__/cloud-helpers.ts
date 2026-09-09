import { deviceLoginResponseSchema } from "@repo/api/cloud/device/device-schema";
import type { DeviceLoginRequest } from "@repo/api/cloud/device/device-schema";
import { syncPingSchema } from "@repo/api/cloud/sync/sync-ws";
import type { SyncPing } from "@repo/api/cloud/sync/sync-ws";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";
import { z } from "zod";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

export const ORIGIN = "https://inteligir-web.workers.dev";
export const PASSWORD = "test-password-1234";

let inviteCounter = 0;

export const signUpUser = async (email: string): Promise<{ bearer: string; password: string }> => {
  const code = `CLOUD-TEST-${(inviteCounter += 1)}`;
  await createDb(env.DB).insert(inviteCode).values({ code });
  const response = await SELF.fetch(`${ORIGIN}/v1/auth/sign-up`, {
    body: JSON.stringify({ email, inviteCode: code, name: "Cloud Tester", password: PASSWORD }),
    headers: { "content-type": "application/json", origin: ORIGIN },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const bearer = response.headers.get("set-auth-token");
  expect(bearer).not.toBeNull();
  return { bearer: bearer ?? "", password: PASSWORD };
};

export const sessionHeaders = (bearer: string) => ({
  authorization: `Bearer ${bearer}`,
  origin: ORIGIN,
});

// binary frames carry no ping, so anything but text is skipped
const textFrameSchema = z.string();

const sessionUserSchema = z.looseObject({
  user: z.looseObject({ email: z.string(), id: z.string() }),
});

const sessionUser = async (bearer: string): Promise<{ id: string; email: string }> => {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
    headers: sessionHeaders(bearer),
  });
  const body = sessionUserSchema.safeParse(await response.json());
  if (!body.success) {
    throw new Error("no session for that bearer");
  }
  return body.data.user;
};

// ask before a test deletes the account; afterwards the session no longer answers
export const userIdOf = async (bearer: string): Promise<string> => {
  const user = await sessionUser(bearer);
  return user.id;
};

export const postLogin = async (body: DeviceLoginRequest): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}/v1/device/login`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

// the bearer only names the account: the device credential comes from the account's own password
export const loginDevice = async (
  bearer: string,
  deviceName: string,
): Promise<{ deviceId: string; credential: string }> => {
  const { email } = await sessionUser(bearer);
  const response = await postLogin({ deviceName, email, password: PASSWORD });
  expect(response.status).toBe(200);
  return deviceLoginResponseSchema.parse(await response.json());
};

export const deviceHeaders = (credential: string) => ({ authorization: `Bearer ${credential}` });

export const openSocket = async (
  credential: string,
  platform: string,
): Promise<{ frames: SyncPing[]; socket: WebSocket }> => {
  const response = await SELF.fetch(`${ORIGIN}/v1/sync/ws?platform=${platform}`, {
    headers: { ...deviceHeaders(credential), upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("no websocket on the 101");
  }
  socket.accept();
  const frames: SyncPing[] = [];
  socket.addEventListener("message", (message) => {
    const text = textFrameSchema.safeParse(message.data);
    if (!text.success) {
      return;
    }
    frames.push(syncPingSchema.parse(JSON.parse(text.data)));
  });
  return { frames, socket };
};

// pings cross the in-process socket pair a macrotask after the push, so frames must be awaited
export const awaitFrames = async (
  socket: { frames: SyncPing[] },
  expected: readonly SyncPing[],
): Promise<void> => {
  await vi.waitFor(() => {
    expect(socket.frames).toEqual(expected);
  });
};
