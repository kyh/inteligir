// ---------------------------------------------------------------------------
// Shared fixtures for the UserHost suites: a real account, a real ticket, a
// real socket, and a frame reader.
//
// Shared rather than copied because every suite drives the SAME admission path
// — sign up, mint a ticket over the session, dial `/v1/host/ws`, spend the
// ticket in the first frame — and a second copy of it would drift the moment
// the handshake changes.
// ---------------------------------------------------------------------------

import { parseServerFrame, type ResFrame, type ServerFrame } from "@repo/bridge/ws-protocol";
import { env, SELF } from "cloudflare:test";
import { expect } from "vitest";

import { createDb } from "../db/client";
import { inviteCode } from "../db/schema";

/** The origin the Worker is reached on — Better Auth derives its baseURL from
 * it, so every request in these suites uses one. */
export const ORIGIN = "https://inteligir-web.workers.dev";

/** A deployed origin the ticket allowlist admits with no configuration. */
export const WEB_ORIGIN = "https://inteligir.com";

/**
 * An account, in both credential shapes.
 *
 * `cookie` is what a BROWSER holds and is what mints a `web` ticket; `token` is
 * the bearer a native client holds and mints a `mobile` one. Both come back
 * from the same sign-up, which is what lets one suite drive both classes.
 */
export type Account = {
  readonly userId: string;
  readonly token: string;
  readonly cookie: string;
};

/** Mint an invite and hand back its code. A UUID rather than a counter: these
 * suites share one D1 per file and `code` is the primary key. */
export async function mintInvite(): Promise<string> {
  const code = crypto.randomUUID();
  await createDb(env.DB).insert(inviteCode).values({ code });
  return code;
}

/**
 * An account, created the only way this deployment creates one: a minted code
 * spent at the invite gate. Better Auth's own sign-up route refuses, so a
 * helper that dialled it would be testing a path production does not have.
 */
export async function signUp(email: string): Promise<Account> {
  const password = "test-password-1234";
  const name = email.split("@")[0] ?? "user";
  const signUpResponse = await SELF.fetch(`${ORIGIN}/v1/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password, name, inviteCode: await mintInvite() }),
  });
  if (signUpResponse.status !== 200) {
    throw new Error(`sign-up failed: ${signUpResponse.status} ${await signUpResponse.text()}`);
  }
  const token = signUpResponse.headers.get("set-auth-token");
  if (token === null || token === "") throw new Error("no set-auth-token header");
  const cookie = cookieFrom(signUpResponse.headers.get("set-cookie"));

  const session = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${token}`, origin: ORIGIN },
  });
  const body = (await session.json()) as { user: { id: string } } | null;
  if (body === null) throw new Error("no session for the token just issued");
  return { userId: body.user.id, token, cookie };
}

/** The `Cookie` request header a browser would send back for `set-cookie`. */
function cookieFrom(setCookie: string | null): string {
  if (setCookie === null || setCookie === "") throw new Error("no set-cookie header");
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((one) => one.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair !== "")
    .join("; ");
}

/** The credential shape a request presents, and with it the class it admits to
 * (see host/client-class): a cookie from an allowed origin is `web`, a bearer
 * with no origin is `mobile`. */
export type Credential = "web" | "mobile";

function credentialHeaders(account: Account, as: Credential): Headers {
  return as === "web"
    ? new Headers({ cookie: account.cookie, origin: WEB_ORIGIN })
    : new Headers({ authorization: `Bearer ${account.token}` });
}

export function mintTicket(account: Account, as: Credential = "web"): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/v1/host/ticket`, {
    method: "POST",
    headers: credentialHeaders(account, as),
  });
}

/** Mint a ticket and return its value, failing the test if the mint refused. */
export async function ticketFor(account: Account, as: Credential = "web"): Promise<string> {
  const response = await mintTicket(account, as);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { ticket: string };
  return body.ticket;
}

function openSocket(account: Account, as: Credential = "web"): Promise<Response> {
  const headers = credentialHeaders(account, as);
  headers.set("upgrade", "websocket");
  return SELF.fetch(`${ORIGIN}/v1/host/ws`, { headers });
}

export type SocketReader = {
  /** The next server frame, in order. */
  next: () => Promise<ServerFrame>;
  /** The close code, once the server closes. */
  closed: Promise<number>;
};

function readFrames(ws: WebSocket): SocketReader {
  const queue: ServerFrame[] = [];
  let waiting: ((frame: ServerFrame) => void) | null = null;
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const frame = parseServerFrame(event.data);
    if (frame === null) return;
    if (waiting === null) {
      queue.push(frame);
      return;
    }
    const resolve = waiting;
    waiting = null;
    resolve(frame);
  });
  const closed = new Promise<number>((resolve) => {
    ws.addEventListener("close", (event) => {
      resolve(event.code);
    });
  });
  return {
    next: () => {
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise<ServerFrame>((resolve) => {
        waiting = resolve;
      });
    },
    closed,
  };
}

export async function accepted(
  account: Account,
  as: Credential = "web",
): Promise<{ ws: WebSocket; frames: SocketReader }> {
  const response = await openSocket(account, as);
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (ws === null) throw new Error("upgrade response carried no webSocket");
  ws.accept();
  return { ws, frames: readFrames(ws) };
}

/**
 * Connect, spend a fresh ticket, and consume the welcome plus every hydration
 * event.
 *
 * The hydration push is drained by asking a question with a known answer and
 * reading until its `res` frame arrives, so a suite never has to know how many
 * events hydration currently pushes.
 */
export async function authenticated(
  account: Account,
  as: Credential = "web",
): Promise<{ ws: WebSocket; frames: SocketReader }> {
  const ticket = await ticketFor(account, as);
  const { ws, frames } = await accepted(account, as);
  ws.send(JSON.stringify({ t: "auth", ticket }));
  expect(await frames.next()).toEqual({ t: "welcome" });
  // `getAgentHistory` rather than a vault read: it is one of the few channels
  // BOTH classes may invoke, so the drain works for a companion socket too.
  ws.send(JSON.stringify({ t: "req", id: 0, method: "getAgentHistory" }));
  for (;;) {
    const frame = await frames.next();
    if (frame.t === "res" && frame.id === 0) break;
  }
  return { ws, frames };
}

/** Send one `req` frame and return its `res`, skipping any events in between. */
export async function invoke(
  ws: WebSocket,
  frames: SocketReader,
  id: number,
  method: string,
  payload?: unknown,
): Promise<ResFrame> {
  ws.send(JSON.stringify({ t: "req", id, method, payload }));
  for (;;) {
    const frame = await frames.next();
    if (frame.t === "res" && frame.id === id) return frame;
  }
}
