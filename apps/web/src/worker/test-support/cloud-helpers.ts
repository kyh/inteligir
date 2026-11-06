import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { AUTH_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import { clientBuildHeaders } from "@repo/contract/cloud/client-build";
import type { ClientBuild } from "@repo/contract/cloud/client-build";
import type { DeviceLoginResponse } from "@repo/contract/cloud/device/device-schema";
import {
  librarySocketFrameSchema,
  SOCKET_TICKET_PARAM,
  V1_SOCKET_PATH,
} from "@repo/contract/cloud/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import { applySetCookies } from "better-auth/cookies";
import { env, exports } from "cloudflare:workers";
import { expect } from "vitest";
import { z } from "zod";
import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";
import { ORIGIN } from "./test-origin";

export { ORIGIN } from "./test-origin";
export const PASSWORD = "test-password-1234";

// what every install's request carries: a build at the floor, which the Worker admits
const floorBuild = (): ClientBuild => ({
  platform: "desktop",
  version: env.MIN_CLIENT_BUILD,
});

// a response a test reads only the status or headers of, its body read to the end: the plugin's
// per-file storage isolation needs every body consumed
// (developers.cloudflare.com/workers/testing/vitest-integration/known-issues)
export const drained = async (pending: Promise<Response>): Promise<Response> => {
  const response = await pending;
  await response.arrayBuffer();
  return response;
};

export const buildHeaders = (): Record<string, string> => clientBuildHeaders(floorBuild());

// a browser on one of this Worker's own pages, which ships in the same deploy and names no build
export const OWN_PAGE_HEADERS = { origin: ORIGIN, "sec-fetch-site": "same-origin" } as const;

// what a browser sends back: the name=value of each cookie the response set
export const cookieHeaderOf = (response: Response): string => {
  const headers = new Headers();
  applySetCookies(headers, response.headers.getSetCookie());
  return headers.get("cookie") ?? "";
};

export const signUpUser = async (email: string): Promise<{ cookie: string; password: string }> => {
  // unique across the socket suites' shared storage, not only within one file
  const code = `CLOUD-TEST-${crypto.randomUUID()}`;
  await createDb(env.DB).insert(inviteCode).values({ code });
  const response = await drained(
    exports.default.fetch(`${ORIGIN}${AUTH_API_PATHS.signUp}`, {
      body: JSON.stringify({ email, inviteCode: code, name: "Cloud Tester", password: PASSWORD }),
      headers: { ...OWN_PAGE_HEADERS, "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  const cookie = cookieHeaderOf(response);
  expect(cookie).toContain("session_token=");
  return { cookie, password: PASSWORD };
};

// clients strip a field they do not declare, so a plain parse here would pass a column the
// worker leaks: what the worker emits is held to exactly the declared shape
const emitted = <TSchema extends z.ZodType>(schema: TSchema, json: string): z.infer<TSchema> => {
  const body: unknown = JSON.parse(json);
  const parsed = schema.parse(body);
  expect(parsed).toStrictEqual(body);
  return parsed;
};

export const sessionHeaders = (cookie: string) => ({ ...OWN_PAGE_HEADERS, cookie });

// binary frames carry no ping, so anything but text is skipped
const textFrameSchema = z.string();

const sessionUserSchema = z.looseObject({
  user: z.looseObject({ email: z.string(), id: z.string() }),
});

const sessionUser = async (cookie: string): Promise<{ id: string; email: string }> => {
  const response = await exports.default.fetch(`${ORIGIN}/api/auth/get-session`, {
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

// a `/v1/rpc` link as an app holds one, its headers fixed, and the status each answer came under
// with the cookies it set
export const v1Link = (headers: Record<string, string>) => {
  const statuses: number[] = [];
  const setCookies: string[][] = [];
  const client = createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => {
        const response = await exports.default.fetch(url, init);
        statuses.push(response.status);
        setCookies.push(response.headers.getSetCookie());
        return response;
      },
      headers,
      origin: ORIGIN,
      url: V1_RPC_PATH,
    }),
  );
  // the refusal a call met, with the status it was answered under
  const refusalOf = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (error) {
      if (error instanceof ORPCError) {
        return {
          code: error.code,
          data: error.data,
          defined: error.defined,
          message: error.message,
          status: statuses.at(-1),
        };
      }
      throw error;
    }
    throw new Error("the call landed what the test expected it to refuse");
  };
  // the client is a proxy, so its two routers are read off it rather than spread
  return { account: client.account, library: client.library, refusalOf, setCookies, statuses };
};

export const deviceHeaders = (credential: string) => ({
  ...buildHeaders(),
  authorization: `Bearer ${credential}`,
});

// a caller at the floor that holds no credential yet: a sign-in or a sign-up
export const anonymous = () => v1Link(buildHeaders());

// the cookie only names the account: the device credential comes from the account's own password
export const loginDevice = async (
  cookie: string,
  deviceName: string,
): Promise<DeviceLoginResponse> => {
  const { email } = await sessionUser(cookie);
  return await anonymous().account.signIn({ deviceName, email, password: PASSWORD });
};

// a device's socket, opened as every client opens it: a ticket its credential minted
export const openSocket = async (
  credential: string,
): Promise<{ frames: LibrarySocketFrame[]; socket: WebSocket }> => {
  const { ticket } = await v1Link(deviceHeaders(credential)).account.socketTicket();
  const response = await exports.default.fetch(
    `${ORIGIN}${V1_SOCKET_PATH}?${SOCKET_TICKET_PARAM}=${encodeURIComponent(ticket)}`,
    { headers: { upgrade: "websocket" } },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("no websocket on the 101");
  }
  socket.accept();
  const frames: LibrarySocketFrame[] = [];
  socket.addEventListener("message", (message) => {
    const text = textFrameSchema.safeParse(message.data);
    if (!text.success) {
      return;
    }
    frames.push(emitted(librarySocketFrameSchema, text.data));
  });
  return { frames, socket };
};
