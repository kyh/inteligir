import {
  librarySocketFrameSchema,
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
  SOCKET_REVOKED_CLOSE_CODE,
  V1_SOCKET_PATH,
} from "@repo/contract/cloud/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import { evictDurableObject, listDurableObjectIds } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  deviceHeaders,
  drained,
  loginDevice,
  ORIGIN,
  sessionHeaders,
  signUpUser,
  userIdOf,
  v1Link,
} from "../test-support/cloud-helpers";
import { CONNECTOR_URL, connectAssistant, workerFetch } from "../test-support/connector-session";
import { issueToken } from "../test-support/password-reset";
import {
  cellOf,
  createItem,
  inCell,
  noteFields,
  paragraph,
  person,
  placed,
} from "../test-support/library-cell";
import { ACCOUNT_PURGE_STEPS } from "./account-purge";
import { openCellLibrary, settleCommit } from "./cell-library";
import { CELL_SOCKET_PATH } from "./cell-sockets";
import { libraryCellName } from "./library-cell";
import { forwardAsPrincipal, SOCKET_HOLDER_HEADER } from "./library-principal";
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

// a browser tab signed in to the site, and the socket it opened on its session's ticket
const signedInTab = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const { ticket } = await v1Link(sessionHeaders(cookie)).account.socketTicket();
  return { cookie, opened: await openWithTicket(ticket) };
};

// a write through the cell's engine, followed by what follows every committed write
const writeInCell = async (accountId: string): Promise<number> =>
  await inCell(cellOf(accountId), async (state) => {
    const library = openCellLibrary(state, env);
    const result = createItem(library, person(), {
      blocks: placed([paragraph("a", "a new note")]),
      fields: noteFields(),
      id: crypto.randomUUID(),
    });
    await settleCommit(state, env, library, result);
    return result.ok && result.head !== null ? result.head : 0;
  });

// "open" once `ms` pass with the socket still open, else the code it closed with
const closedWithin = async (opened: OpenSocket, ms: number): Promise<number | "open"> => {
  const stillOpen = async (): Promise<"open"> => {
    await scheduler.wait(ms);
    return "open";
  };
  return await Promise.race([opened.closed, stillOpen()]);
};

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
    expect(first.frames).toStrictEqual([{ head, type: "library" }]);
    expect(second.frames).toStrictEqual([{ head, type: "library" }]);
    first.socket.send(SOCKET_KEEPALIVE_PING);
    await until(() => first.texts.includes(SOCKET_KEEPALIVE_PONG));
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
    await expect(v1Link(deviceHeaders(login.credential)).account.signOut()).resolves.toStrictEqual({
      revoked: true,
    });
    const revoked = await drained(upgrade(`${V1_SOCKET_PATH}?ticket=${ticket}`));
    expect(revoked.status).toBe(401);

    // the sign-out reached the account's own cell, and no refusal named the victim's
    const ids = await listDurableObjectIds(env.LIBRARY_CELL);
    const ownCell = exports.LibraryDO.idFromName(libraryCellName(accountId));
    expect(ids.some((id) => id.equals(ownCell))).toBe(true);
    expect(ids.some((id) => id.equals(victimCell))).toBe(false);
  });

  it("stamps the holder the ticket verified over one the request names", async () => {
    const { cookie } = await signUpUser("socket-stamped@example.test");
    const laptop = await loginDevice(cookie, "Laptop");
    const phone = await loginDevice(cookie, "Phone");
    const accountId = await userIdOf(cookie);
    const { ticket } = await v1Link(deviceHeaders(laptop.credential)).account.socketTicket();
    // the laptop's ticket, claiming to be the phone's socket
    const response = await upgrade(`${V1_SOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`, {
      [SOCKET_HOLDER_HEADER]: `device:${phone.deviceId}`,
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (socket === null) {
      throw new Error("no websocket on the 101");
    }
    const opened = listen(socket);
    // the phone's revocation leaves the socket the laptop opened, whatever it claimed
    await cellOf(accountId).sever({ id: phone.deviceId, kind: "device" });
    await expect(closedWithin(opened, 300)).resolves.toBe("open");
    await cellOf(accountId).sever({ id: laptop.deviceId, kind: "device" });
    await expect(opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("closes a socket whose device was revoked while its upgrade was on the way", async () => {
    const { login, ticket } = await signedInDevice("socket-race@example.test");
    await v1Link(deviceHeaders(login.credential)).account.signOut();
    // the upgrade's own check read the device before the revocation, whose sever then found no
    // socket to close
    const prepare = env.DB.prepare.bind(env.DB);
    const staleRead = vi
      .spyOn(env.DB, "prepare")
      .mockImplementationOnce((query) =>
        prepare(query.replace('"device"."revoked_at" is null', "1 = 1")),
      );
    const opened = await openWithTicket(ticket);
    staleRead.mockRestore();
    await expect(opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("opens for no assistant's token, on any path under the connector, under any holder", async () => {
    const { cookie } = await signUpUser("socket-connector@example.test");
    const accountId = await userIdOf(cookie);
    const login = await loginDevice(cookie, "Laptop");
    const assistant = await connectAssistant(cookie, { readOnly: true });
    const response = await workerFetch(`${CONNECTOR_URL}/anything`, {
      headers: {
        authorization: `Bearer ${assistant.access_token}`,
        [SOCKET_HOLDER_HEADER]: `device:${login.deviceId}`,
        upgrade: "websocket",
      },
    });
    await response.arrayBuffer();
    expect(response.webSocket).toBeNull();
    expect(response.status).toBe(404);
    await expect(inCell(cellOf(accountId), (state) => state.getWebSockets().length)).resolves.toBe(
      0,
    );
  });

  it("is taken by the cell on its own path alone", async () => {
    const accountId = crypto.randomUUID();
    const headers = { [SOCKET_HOLDER_HEADER]: "device:laptop-1", upgrade: "websocket" };
    for (const path of ["/connector/anything", "/socket/anything", "/"]) {
      const answer = await drained(
        cellOf(accountId).fetch(`https://cell.test${path}`, { headers }),
      );
      expect(answer.status).toBe(404);
    }
    await expect(inCell(cellOf(accountId), (state) => state.getWebSockets().length)).resolves.toBe(
      0,
    );
  });

  it("takes no holder from a call forwarded under a principal", async () => {
    const accountId = crypto.randomUUID();
    const answer = await drained(
      forwardAsPrincipal(
        exports,
        new Request(`https://cell.test${CELL_SOCKET_PATH}`, {
          headers: { [SOCKET_HOLDER_HEADER]: "device:laptop-1", upgrade: "websocket" },
        }),
        {
          accountId,
          actor: {
            clientId: "client-1",
            clientName: "Claude",
            grantId: "grant-1",
            kind: "assistant",
          },
          scopes: ["library:read"],
        },
      ),
    );
    expect(answer.status).toBe(400);
  });

  it("closes a tab's socket once the app signs its session out", async () => {
    const tab = await signedInTab("socket-session-app@example.test");
    await expect(v1Link(sessionHeaders(tab.cookie)).account.signOut()).resolves.toStrictEqual({
      revoked: true,
    });
    await expect(tab.opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("closes a tab's socket once the site signs its session out", async () => {
    const tab = await signedInTab("socket-session-site@example.test");
    const signedOut = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/sign-out`, {
        headers: sessionHeaders(tab.cookie),
        method: "POST",
      }),
    );
    expect(signedOut.status).toBe(200);
    await expect(tab.opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("closes every tab's socket at a password reset, and leaves a device's open", async () => {
    const email = "socket-session-reset@example.test";
    const tab = await signedInTab(email);
    const accountId = await userIdOf(tab.cookie);
    const login = await loginDevice(tab.cookie, "Laptop");
    const { ticket } = await mintSocketTicket(
      env.BETTER_AUTH_SECRET,
      { accountId, holder: { id: login.deviceId, kind: "device" } },
      Date.now(),
    );
    const laptop = await openWithTicket(ticket);
    const reset = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/reset-password`, {
        body: JSON.stringify({ newPassword: "new-password-5678", token: await issueToken(email) }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      }),
    );
    expect(reset.status).toBe(200);
    await expect(tab.opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
    // a reset revokes sessions only, never a device's credential (`../auth/auth.ts`)
    await expect(closedWithin(laptop, 300)).resolves.toBe("open");
  });

  it("closes its sockets at a deletion's tombstone, and refuses another while a credential still verifies", async () => {
    const { accountId, ticket } = await signedInDevice("socket-deleted@example.test");
    const opened = await openWithTicket(ticket);
    await inCell(cellOf(accountId), async (state) => {
      const tombstone = ACCOUNT_PURGE_STEPS.find((step) => step.name === "tombstone");
      await tombstone?.run({ accountId, ctx: state, email: "socket-deleted@example.test", env });
    });
    await expect(opened.closed).resolves.toBe(1001);
    const refused = await drained(
      upgrade(`${V1_SOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`),
    );
    expect(refused.status).toBe(410);
  });

  it("keeps its sockets through an eviction, hibernated, and still sends them each write", async () => {
    const { accountId, ticket } = await signedInDevice("socket-evicted@example.test");
    const opened = await openWithTicket(ticket);
    await evictDurableObject(cellOf(accountId), { webSockets: "hibernate" });
    const head = await writeInCell(accountId);
    await until(() => opened.frames.length > 0);
    expect(opened.frames).toStrictEqual([{ head, type: "library" }]);
  });
});
