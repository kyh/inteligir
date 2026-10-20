import { ACCOUNT_API_PATHS, AUTH_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import { clientBuildHeaders } from "@repo/contract/cloud/client-build";
import type { ClientBuild } from "@repo/contract/cloud/client-build";
import {
  DEVICE_API_PATHS,
  deviceLoginResponseSchema,
} from "@repo/contract/cloud/device/device-schema";
import type {
  DeviceLoginRequest,
  DeviceLoginResponse,
} from "@repo/contract/cloud/device/device-schema";
import { cloudErrorSchema } from "@repo/contract/cloud/errors";
import { SYNC_WS_PATH, syncPingSchema } from "@repo/contract/cloud/sync/sync-ws";
import type { SyncPing } from "@repo/contract/cloud/sync/sync-ws";
import { applySetCookies } from "better-auth/cookies";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { z } from "zod";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

export const ORIGIN = "https://inteligir-web.workers.dev";
export const PASSWORD = "test-password-1234";

// what every install's request carries: a build at the floor, which the Worker admits
const floorBuild = (): ClientBuild => ({
  platform: "desktop",
  version: env.MIN_CLIENT_BUILD,
});

export const buildHeaders = (): Record<string, string> => clientBuildHeaders(floorBuild());

// a browser on one of this Worker's own pages, which ships in the same deploy and names no build
export const OWN_PAGE_HEADERS = { origin: ORIGIN, "sec-fetch-site": "same-origin" } as const;

let inviteCounter = 0;

// what a browser sends back: the name=value of each cookie the response set
export const cookieHeaderOf = (response: Response): string => {
  const headers = new Headers();
  applySetCookies(headers, response.headers.getSetCookie());
  return headers.get("cookie") ?? "";
};

export const signUpUser = async (email: string): Promise<{ cookie: string; password: string }> => {
  const code = `CLOUD-TEST-${(inviteCounter += 1)}`;
  await createDb(env.DB).insert(inviteCode).values({ code });
  const response = await SELF.fetch(`${ORIGIN}${AUTH_API_PATHS.signUp}`, {
    body: JSON.stringify({ email, inviteCode: code, name: "Cloud Tester", password: PASSWORD }),
    headers: { ...OWN_PAGE_HEADERS, "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const cookie = cookieHeaderOf(response);
  expect(cookie).toContain("session_token=");
  return { cookie, password: PASSWORD };
};

// clients strip a field they do not declare, so a plain parse here would pass a column the
// worker leaks: what the worker emits is held to exactly the declared shape
export const emitted = <TSchema extends z.ZodType>(
  schema: TSchema,
  json: string,
): z.infer<TSchema> => {
  const body: unknown = JSON.parse(json);
  const parsed = schema.parse(body);
  expect(parsed).toStrictEqual(body);
  return parsed;
};

export const refusalCodeOf = async (response: Response): Promise<string> =>
  emitted(cloudErrorSchema, await response.text()).error.code;

export const sessionHeaders = (cookie: string) => ({ ...OWN_PAGE_HEADERS, cookie });

// binary frames carry no ping, so anything but text is skipped
const textFrameSchema = z.string();

const sessionUserSchema = z.looseObject({
  user: z.looseObject({ email: z.string(), id: z.string() }),
});

const sessionUser = async (cookie: string): Promise<{ id: string; email: string }> => {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
    headers: sessionHeaders(cookie),
  });
  const body = sessionUserSchema.safeParse(await response.json());
  if (!body.success) {
    throw new Error("no session for that cookie");
  }
  return body.data.user;
};

// ask before a test deletes the account; afterwards the session no longer answers
export const userIdOf = async (cookie: string): Promise<string> => {
  const user = await sessionUser(cookie);
  return user.id;
};

export const postLogin = async (body: DeviceLoginRequest): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}/v1/device/login`, {
    body: JSON.stringify(body),
    headers: { ...buildHeaders(), "content-type": "application/json" },
    method: "POST",
  });

// the cookie only names the account: the device credential comes from the account's own password
export const loginDevice = async (
  cookie: string,
  deviceName: string,
): Promise<DeviceLoginResponse> => {
  const { email } = await sessionUser(cookie);
  const response = await postLogin({ deviceName, email, password: PASSWORD });
  expect(response.status).toBe(200);
  return emitted(deviceLoginResponseSchema, await response.text());
};

export const deviceHeaders = (credential: string) => ({
  ...buildHeaders(),
  authorization: `Bearer ${credential}`,
});

// loose on purpose: a refusal test posts what the contract refuses
export type VaultReadBody = Readonly<
  Record<string, string | number | boolean | readonly string[] | undefined>
>;

// a vault read as this build's clients send it: the query in a POST body, never the URL
export const postVaultRead = async (
  path: string,
  auth: Record<string, string>,
  query: VaultReadBody,
): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${path}`, {
    body: JSON.stringify(query),
    headers: { ...auth, "content-type": "application/json" },
    method: "POST",
  });

// the one door deletion has: a device credential, and the password asked again
export const postAccountDelete = async (
  authorization: Record<string, string>,
  password: string,
): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${ACCOUNT_API_PATHS.delete}`, {
    body: JSON.stringify({ password }),
    headers: { ...authorization, "content-type": "application/json" },
    method: "POST",
  });

export const postSignOut = async (authorization: Record<string, string>): Promise<Response> =>
  await SELF.fetch(`${ORIGIN}${DEVICE_API_PATHS.signOut}`, {
    body: "{}",
    headers: { ...authorization, "content-type": "application/json" },
    method: "POST",
  });

export const openSocket = async (
  credential: string,
): Promise<{ frames: SyncPing[]; socket: WebSocket }> => {
  const response = await SELF.fetch(`${ORIGIN}${SYNC_WS_PATH}`, {
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
    frames.push(emitted(syncPingSchema, text.data));
  });
  return { frames, socket };
};
