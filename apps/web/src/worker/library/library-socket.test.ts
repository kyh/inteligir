import {
  librarySocketFrameSchema,
  V1_SOCKET_PATH,
} from "@repo/contract/cloud/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import {
  SYNC_WS_KEEPALIVE_PING,
  SYNC_WS_KEEPALIVE_PONG,
  SYNC_WS_PATH,
} from "@repo/contract/cloud/sync/sync-ws";
import { evictDurableObject, listDurableObjectIds } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  refusalCodeOf,
  signUpUser,
  userIdOf,
} from "../test-support/cloud-helpers";
import {
  cellOf,
  inCell,
  noteFields,
  paragraph,
  person,
  placed,
} from "../test-support/library-cell";
import { ACCOUNT_PURGE_STEPS } from "./account-purge";
import { openCellLibrary, settleCommit } from "./cell-library";
import { SOCKET_HOLDER_HEADER } from "./cell-sockets";
import { libraryCellName } from "./library-cell";
import { mintSocketTicket } from "./socket-ticket";

interface OpenSocket {
  readonly socket: WebSocket;
  // the library frames it heard, and every text frame
  readonly frames: LibrarySocketFrame[];
  readonly texts: string[];
  readonly closed: Promise<number>;
}

const textSchema = z.string();

const listen = (socket: WebSocket): OpenSocket => {
  socket.accept();
  const frames: LibrarySocketFrame[] = [];
  const texts: string[] = [];
  socket.addEventListener("message", (message) => {
    const text = textSchema.safeParse(message.data);
    if (!text.success) {
      return;
    }
    texts.push(text.data);
    const frame = librarySocketFrameSchema.safeParse(
      text.data.startsWith("{") ? JSON.parse(text.data) : null,
    );
    if (frame.success) {
      frames.push(frame.data);
    }
  });
  // oxlint-disable-next-line promise/avoid-new -- a socket's close arrives as an event, which only a promise can hand to an await
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", (close) => {
      resolve(close.code);
    });
  });
  return { closed, frames, socket, texts };
};

const upgrade = async (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  await exports.default.fetch(`${ORIGIN}${path}`, {
    headers: { ...headers, upgrade: "websocket" },
  });

const openWithTicket = async (ticket: string): Promise<OpenSocket> => {
  const response = await upgrade(`${V1_SOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`);
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("no websocket on the 101");
  }
  return listen(socket);
};

// a signed-in device and the ticket its socket opens with
const signedInDevice = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const login = await loginDevice(cookie, "Laptop");
  const accountId = await userIdOf(cookie);
  const { ticket } = await mintSocketTicket(
    env.BETTER_AUTH_SECRET,
    { accountId, holder: { id: login.deviceId, kind: "device" } },
    Date.now(),
  );
  return { accountId, login, ticket };
};

// a write through the cell's engine, followed by what follows every committed write
const writeInCell = async (accountId: string): Promise<number> =>
  await inCell(cellOf(accountId), async (state) => {
    const library = openCellLibrary(state, env);
    const result = library.create(person(), {
      blocks: placed([paragraph("a", "a new note")]),
      fields: noteFields(),
      id: crypto.randomUUID(),
    });
    await settleCommit(state, library, result);
    return result.ok && result.head !== null ? result.head : 0;
  });

const until = async (check: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 50 && !check(); tries += 1) {
    await scheduler.wait(20);
  }
  expect(check()).toBe(true);
};

describe("the account's socket", () => {
  it("opens with a ticket, hears each committed write, and answers its keepalive", async () => {
    const { accountId, ticket } = await signedInDevice("socket-ticket@example.test");
    const first = await openWithTicket(ticket);
    const second = await openWithTicket(ticket);
    const head = await writeInCell(accountId);
    await until(() => first.frames.length > 0 && second.frames.length > 0);
    expect(first.frames).toEqual([{ head, type: "library" }]);
    expect(second.frames).toEqual([{ head, type: "library" }]);
    first.socket.send(SYNC_WS_KEEPALIVE_PING);
    await until(() => first.texts.includes(SYNC_WS_KEEPALIVE_PONG));
  });

  it("keeps an account's frames to its own sockets", async () => {
    const mine = await signedInDevice("socket-mine@example.test");
    const theirs = await signedInDevice("socket-theirs@example.test");
    const mineSocket = await openWithTicket(mine.ticket);
    const theirSocket = await openWithTicket(theirs.ticket);
    await writeInCell(mine.accountId);
    await until(() => mineSocket.frames.length > 0);
    await writeInCell(theirs.accountId);
    await until(() => theirSocket.frames.length > 0);
    expect(mineSocket.frames).toHaveLength(1);
    expect(theirSocket.frames).toHaveLength(1);
  });

  it("refuses a forged, expired or revoked ticket before naming any cell", async () => {
    const { accountId, login, ticket } = await signedInDevice("socket-refused@example.test");
    const victim = crypto.randomUUID();
    const forged = await mintSocketTicket(
      "not the Worker's secret",
      { accountId: victim, holder: { id: login.deviceId, kind: "device" } },
      Date.now(),
    );
    const expired = await mintSocketTicket(
      env.BETTER_AUTH_SECRET,
      { accountId, holder: { id: login.deviceId, kind: "device" } },
      Date.now() - 120_000,
    );
    const victimCell = exports.LibraryDO.idFromName(libraryCellName(victim));
    for (const refused of [forged.ticket, expired.ticket, "nonsense"]) {
      const response = await drained(upgrade(`${V1_SOCKET_PATH}?ticket=${refused}`));
      expect(response.status).toBe(401);
    }
    const missing = await drained(upgrade(V1_SOCKET_PATH));
    expect(missing.status).toBe(401);
    const notAnUpgrade = await drained(
      exports.default.fetch(`${ORIGIN}${V1_SOCKET_PATH}?ticket=${ticket}`),
    );
    expect(notAnUpgrade.status).toBe(400);

    // signing out revokes the credential, and a ticket it minted before no longer opens
    const signedOut = await drained(
      exports.default.fetch(`${ORIGIN}/v1/device/sign-out`, {
        body: "{}",
        headers: { ...deviceHeaders(login.credential), "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(signedOut.status).toBe(200);
    const revoked = await drained(upgrade(`${V1_SOCKET_PATH}?ticket=${ticket}`));
    expect(revoked.status).toBe(401);

    // the sign-out reached the account's own cell, and no refusal named the victim's
    const ids = await listDurableObjectIds(env.LIBRARY_CELL);
    const ownCell = exports.LibraryDO.idFromName(libraryCellName(accountId));
    expect(ids.some((id) => id.equals(ownCell))).toBe(true);
    expect(ids.some((id) => id.equals(victimCell))).toBe(false);
  });

  it("stamps the holder the credential verified over one the request names", async () => {
    const { cookie } = await signUpUser("socket-stamped@example.test");
    const laptop = await loginDevice(cookie, "Laptop");
    const phone = await loginDevice(cookie, "Phone");
    const accountId = await userIdOf(cookie);
    // the laptop's bearer, claiming to be the phone's socket
    const response = await upgrade(SYNC_WS_PATH, {
      ...deviceHeaders(laptop.credential),
      [SOCKET_HOLDER_HEADER]: `device:${phone.deviceId}`,
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (socket === null) {
      throw new Error("no websocket on the 101");
    }
    const opened = listen(socket);
    await cellOf(accountId).severDevice(phone.deviceId);
    await cellOf(accountId).severDevice(laptop.deviceId);
    expect(await opened.closed).toBe(1008);
  });

  it("closes its sockets at a deletion's tombstone, and refuses another while a credential still verifies", async () => {
    const { accountId, ticket } = await signedInDevice("socket-deleted@example.test");
    const opened = await openWithTicket(ticket);
    await inCell(cellOf(accountId), async (state) => {
      const tombstone = ACCOUNT_PURGE_STEPS.find((step) => step.name === "tombstone");
      await tombstone?.run({ accountId, ctx: state, email: "socket-deleted@example.test", env });
    });
    expect(await opened.closed).toBe(1001);
    const refused = await upgrade(`${V1_SOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`);
    expect(refused.status).toBe(410);
    expect(await refusalCodeOf(refused)).toBe("account-deleted");
  });

  it("keeps its sockets through an eviction, hibernated, and still sends them each write", async () => {
    const { accountId, ticket } = await signedInDevice("socket-evicted@example.test");
    const opened = await openWithTicket(ticket);
    await evictDurableObject(cellOf(accountId), { webSockets: "hibernate" });
    const head = await writeInCell(accountId);
    await until(() => opened.frames.length > 0);
    expect(opened.frames).toEqual([{ head, type: "library" }]);
  });
});
