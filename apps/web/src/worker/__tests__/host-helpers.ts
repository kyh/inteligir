// ---------------------------------------------------------------------------
// Shared fixtures for the UserHost suites: a real account, a real socket, and
// a frame reader.
//
// Shared rather than copied because both suites drive the SAME admission path —
// sign up, dial `/v1/host/:userId/ws`, present the bearer in the first frame —
// and a second copy of it would drift the moment the handshake changes.
// ---------------------------------------------------------------------------

import { parseServerFrame, type ResFrame, type ServerFrame } from "@repo/bridge/ws-protocol";
import { SELF } from "cloudflare:test";
import { expect } from "vitest";

/** The origin the Worker is reached on — Better Auth derives its baseURL from
 * it, so every request in these suites uses one. */
export const ORIGIN = "https://inteligir-web.workers.dev";

/** A deployed origin the socket allowlist admits with no configuration. */
export const WEB_ORIGIN = "https://inteligir.com";

export type Account = { readonly userId: string; readonly token: string };

export async function signUp(email: string): Promise<Account> {
  const password = "test-password-1234";
  const name = email.split("@")[0] ?? "user";
  const signUpResponse = await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password, name }),
  });
  if (signUpResponse.status !== 200) {
    throw new Error(`sign-up failed: ${signUpResponse.status} ${await signUpResponse.text()}`);
  }
  const token = signUpResponse.headers.get("set-auth-token");
  if (token === null || token === "") throw new Error("no set-auth-token header");

  const session = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${token}`, origin: ORIGIN },
  });
  const body = (await session.json()) as { user: { id: string } } | null;
  if (body === null) throw new Error("no session for the token just issued");
  return { userId: body.user.id, token };
}

export function openSocket(userId: string, origin: string | null): Promise<Response> {
  const headers = new Headers({ upgrade: "websocket" });
  if (origin !== null) headers.set("origin", origin);
  return SELF.fetch(`${ORIGIN}/v1/host/${encodeURIComponent(userId)}/ws`, { headers });
}

export type SocketReader = {
  /** The next server frame, in order. */
  next: () => Promise<ServerFrame>;
  /** The close code, once the server closes. */
  closed: Promise<number>;
};

export function readFrames(ws: WebSocket): SocketReader {
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

export async function accepted(userId: string): Promise<{ ws: WebSocket; frames: SocketReader }> {
  const response = await openSocket(userId, WEB_ORIGIN);
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (ws === null) throw new Error("upgrade response carried no webSocket");
  ws.accept();
  return { ws, frames: readFrames(ws) };
}

/**
 * Connect, authenticate, and consume the welcome plus every hydration event.
 *
 * The hydration push is drained by asking a question with a known answer and
 * reading until its `res` frame arrives, so a suite never has to know how many
 * events hydration currently pushes.
 */
export async function authenticated(
  account: Account,
): Promise<{ ws: WebSocket; frames: SocketReader }> {
  const { ws, frames } = await accepted(account.userId);
  ws.send(JSON.stringify({ t: "auth", token: account.token }));
  expect(await frames.next()).toEqual({ t: "welcome" });
  ws.send(JSON.stringify({ t: "req", id: 0, method: "getVaultRoot" }));
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
