import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { AUTH_API_PATHS } from "@repo/contract/cloud/account/account-schema";
import { clientBuildHeaders } from "@repo/contract/cloud/client-build";
import type { ClientBuild } from "@repo/contract/cloud/client-build";
import { PHONE_ORIGIN } from "@repo/contract/cloud/origin";
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
import { isOrpcError } from "@repo/contract/cloud/v1/errors";

export { ORIGIN } from "./test-origin";
export const PASSWORD = "test-password-1234";

// what every install's request carries: a build at the floor, which the Worker admits
const floorBuild = (): ClientBuild => ({
  platform: "mobile",
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

// the browser the site's sign-up is made in
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

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
      headers: {
        ...OWN_PAGE_HEADERS,
        "content-type": "application/json",
        "user-agent": BROWSER_USER_AGENT,
      },
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

const sessionSchema = z.looseObject({
  session: z.looseObject({ id: z.string() }),
  user: z.looseObject({ id: z.string() }),
});

const sessionOf = async (cookie: string) => {
  const response = await exports.default.fetch(`${ORIGIN}/api/auth/get-session`, {
    headers: sessionHeaders(cookie),
  });
  const body = sessionSchema.safeParse(await response.json());
  if (!body.success) {
    throw new Error("no session for that cookie");
  }
  return body.data;
};

// ask before a test deletes the account; afterwards the session no longer answers
export const userIdOf = async (cookie: string): Promise<string> => {
  const { user } = await sessionOf(cookie);
  return user.id;
};

// the session a cookie names, as the windows a session's calls spend are keyed on it
export const sessionIdOf = async (cookie: string): Promise<string> => {
  const { session } = await sessionOf(cookie);
  return session.id;
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
      if (isOrpcError(error)) {
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

// a session cookie's value as the browser's jar holds it, signed and encoded as Better Auth set it
export const sessionTokenOf = (cookie: string): string => {
  const value = cookie
    .split("; ")
    .find((pair) => pair.split("=")[0]?.endsWith("session_token") === true)
    ?.split("=")[1];
  if (value === undefined) {
    throw new Error("no session cookie");
  }
  return value;
};

// what the phone's runtime sends with its calls: its build, the cookie it keeps and its app scheme
export const phoneHeaders = (cookie: string) => ({
  ...buildHeaders(),
  cookie,
  "expo-origin": PHONE_ORIGIN,
});

// what the browser extension sends: its build, and the browser's own session cookie as a bearer
export const extensionHeaders = (cookie: string) => ({
  ...buildHeaders(),
  authorization: `Bearer ${sessionTokenOf(cookie)}`,
});

// the system networking stack's user agent, which the phone's native requests carry
export const PHONE_USER_AGENT = "inteligir/1 CFNetwork/3826.500.111 Darwin/25.0.0";

// the phone's sign-in as its runtime makes it: Better Auth's own route, the app scheme named in
// `expo-origin`, which a native request sends in place of an Origin
export const signInPhone = async (email: string, password = PASSWORD): Promise<string> => {
  const response = await drained(
    exports.default.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json",
        "expo-origin": PHONE_ORIGIN,
        "user-agent": PHONE_USER_AGENT,
      },
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
  return cookieHeaderOf(response);
};

// the phone's sign-out as its runtime makes it: Better Auth's own route, which ends the session
// the cookie names
export const signOutPhone = async (cookie: string): Promise<void> => {
  const response = await drained(
    exports.default.fetch(`${ORIGIN}/api/auth/sign-out`, {
      body: "{}",
      headers: { "content-type": "application/json", cookie, "expo-origin": PHONE_ORIGIN },
      method: "POST",
    }),
  );
  expect(response.status).toBe(200);
};

// a socket opened as every client opens one: on a ticket minted under these headers' session
export const openSocketAs = async (
  headers: Record<string, string>,
): Promise<{ frames: LibrarySocketFrame[]; socket: WebSocket }> => {
  const { ticket } = await v1Link(headers).account.socketTicket();
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
