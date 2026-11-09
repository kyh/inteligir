import {
  librarySocketFrameSchema,
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
  SOCKET_REVOKED_CLOSE_CODE,
  V1_SOCKET_PATH,
} from "@repo/contract/library/library-socket";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { RAINDROP_EXPORT } from "../imports/test-support/raindrop-export";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { evictDurableObject, listDurableObjectIds } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  drained,
  extensionHeaders,
  ORIGIN,
  phoneHeaders,
  sessionHeaders,
  sessionIdOf,
  signInPhone,
  signOutPhone,
  signUpUser,
  userIdOf,
  v1Link,
} from "../test-support/cloud-helpers";
import { asLaptop, cellRows, script, settled } from "../test-support/agent-turns";
import {
  CONNECTOR_URL,
  connectAssistant,
  connectorClient,
  workerFetch,
} from "../test-support/connector-session";
import { ended, runAlarmsUntil, startImport } from "../test-support/library-files";
import { issueToken } from "../test-support/password-reset";
import {
  cellOf,
  createItem,
  inCell,
  landedValue,
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

// a phone signed in beside the site's sign-up, its session's id and the ticket its socket opens with
const signedInPhone = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const phone = await signInPhone(email);
  const accountId = await userIdOf(cookie);
  const sessionId = await sessionIdOf(phone);
  const { ticket } = await mintSocketTicket(
    env.BETTER_AUTH_SECRET,
    { accountId, holder: { id: sessionId, kind: "session" } },
    Date.now(),
  );
  return { accountId, cookie, phone, sessionId, ticket };
};

// a browser tab signed in to the site, and the socket it opened on its session's ticket
const signedInTab = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const { ticket } = await v1Link(sessionHeaders(cookie)).account.socketTicket();
  return { cookie, opened: await openWithTicket(ticket) };
};

// a write through the cell's engine, followed by what follows every committed write: the item it
// made, at the sequence it holds
const writeInCell = async (accountId: string): Promise<{ id: string; seq: number }> =>
  await inCell(cellOf(accountId), async (state) => {
    const library = openCellLibrary(state, env);
    const id = crypto.randomUUID();
    const result = createItem(library, person(), {
      blocks: placed([paragraph("a", "a new note")]),
      fields: noteFields(),
      id,
    });
    await settleCommit(state, env, library, result);
    return { id, seq: landedValue(result).item.seq };
  });

// the frame a write that made one item sends
const itemWritten = ({ id, seq }: { id: string; seq: number }): LibrarySocketFrame[] => [
  { folders: false, items: [{ id, seq }], threads: [], type: "moved" },
];

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
    const { accountId, ticket } = await signedInPhone("socket-ticket@example.test");
    const first = await openWithTicket(ticket);
    const second = await openWithTicket(ticket);
    const written = await writeInCell(accountId);
    await until(() => first.frames.length > 0 && second.frames.length > 0);
    expect(first.frames).toStrictEqual(itemWritten(written));
    expect(second.frames).toStrictEqual(itemWritten(written));
    first.socket.send(SOCKET_KEEPALIVE_PING);
    await until(() => first.texts.includes(SOCKET_KEEPALIVE_PONG));
  });

  it("keeps an account's frames to its own sockets", async () => {
    const mine = await signedInPhone("socket-mine@example.test");
    const theirs = await signedInPhone("socket-theirs@example.test");
    const mineSocket = await openWithTicket(mine.ticket);
    const theirSocket = await openWithTicket(theirs.ticket);
    const mineWritten = await writeInCell(mine.accountId);
    await until(() => mineSocket.frames.length > 0);
    const theirsWritten = await writeInCell(theirs.accountId);
    await until(() => theirSocket.frames.length > 0);
    expect(mineSocket.frames).toStrictEqual(itemWritten(mineWritten));
    expect(theirSocket.frames).toStrictEqual(itemWritten(theirsWritten));
  });

  it("refuses a forged, expired or revoked ticket before naming any cell", async () => {
    const { accountId, phone, sessionId, ticket } = await signedInPhone(
      "socket-refused@example.test",
    );
    const victim = crypto.randomUUID();
    const forged = await mintSocketTicket(
      "not the Worker's secret",
      { accountId: victim, holder: { id: sessionId, kind: "session" } },
      Date.now(),
    );
    const expired = await mintSocketTicket(
      env.BETTER_AUTH_SECRET,
      { accountId, holder: { id: sessionId, kind: "session" } },
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

    // signing out ends the session, and a ticket it minted before no longer opens
    await signOutPhone(phone);
    const revoked = await drained(upgrade(`${V1_SOCKET_PATH}?ticket=${ticket}`));
    expect(revoked.status).toBe(401);

    // the sign-out reached the account's own cell, and no refusal named the victim's
    const ids = await listDurableObjectIds(env.LIBRARY_CELL);
    const ownCell = exports.LibraryDO.idFromName(libraryCellName(accountId));
    expect(ids.some((id) => id.equals(ownCell))).toBe(true);
    expect(ids.some((id) => id.equals(victimCell))).toBe(false);
  });

  it("opens on a ticket alone, never on a session's cookie or bearer", async () => {
    const { cookie } = await signUpUser("socket-ticket-alone@example.test");
    const phone = await signInPhone("socket-ticket-alone@example.test");
    for (const headers of [sessionHeaders(cookie), phoneHeaders(phone), extensionHeaders(cookie)]) {
      const response = await drained(upgrade(V1_SOCKET_PATH, headers));
      expect(response.status).toBe(401);
    }
  });

  it("stamps the holder the ticket verified over one the request names", async () => {
    const email = "socket-stamped@example.test";
    const { cookie } = await signUpUser(email);
    const accountId = await userIdOf(cookie);
    const tabId = await sessionIdOf(cookie);
    const phoneId = await sessionIdOf(await signInPhone(email));
    const { ticket } = await v1Link(sessionHeaders(cookie)).account.socketTicket();
    // the tab's ticket, claiming to be the phone's socket
    const response = await upgrade(`${V1_SOCKET_PATH}?ticket=${encodeURIComponent(ticket)}`, {
      [SOCKET_HOLDER_HEADER]: `session:${phoneId}`,
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (socket === null) {
      throw new Error("no websocket on the 101");
    }
    const opened = listen(socket);
    // the phone's end leaves the socket the tab opened, whatever it claimed
    await cellOf(accountId).sever({ id: phoneId, kind: "session" });
    await expect(closedWithin(opened, 300)).resolves.toBe("open");
    await cellOf(accountId).sever({ id: tabId, kind: "session" });
    await expect(opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("closes a socket whose session ended while its upgrade was on the way", async () => {
    const { phone, ticket } = await signedInPhone("socket-race@example.test");
    await signOutPhone(phone);
    // the upgrade's own check read the session before its end, whose sever then found no socket to
    // close: read here as the account's other session, the sign-up's, which still stands
    const prepare = env.DB.prepare.bind(env.DB);
    const staleRead = vi
      .spyOn(env.DB, "prepare")
      .mockImplementationOnce((query) =>
        prepare(query.replace('"session"."id" = ?', '"session"."id" <> ?')),
      );
    const opened = await openWithTicket(ticket);
    staleRead.mockRestore();
    await expect(opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("opens for no assistant's token, on any path under the connector, under any holder", async () => {
    const { cookie } = await signUpUser("socket-connector@example.test");
    const accountId = await userIdOf(cookie);
    const assistant = await connectAssistant(cookie, { readOnly: true });
    const response = await workerFetch(`${CONNECTOR_URL}/anything`, {
      headers: {
        authorization: `Bearer ${assistant.access_token}`,
        [SOCKET_HOLDER_HEADER]: `session:${await sessionIdOf(cookie)}`,
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
    const headers = { [SOCKET_HOLDER_HEADER]: "session:laptop-1", upgrade: "websocket" };
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
          headers: { [SOCKET_HOLDER_HEADER]: "session:laptop-1", upgrade: "websocket" },
        }),
        {
          accountId,
          actor: {
            clientId: "client-1",
            clientName: "Claude",
            grantId: "grant-1",
            kind: "assistant",
            scopes: ["library:read"],
          },
        },
      ),
    );
    expect(answer.status).toBe(400);
  });

  it("closes a phone's socket once another device ends its session", async () => {
    const { cookie, sessionId, ticket } = await signedInPhone("socket-session-ended@example.test");
    const opened = await openWithTicket(ticket);
    await expect(
      v1Link(sessionHeaders(cookie)).account.devices.revoke({ id: sessionId }),
    ).resolves.toStrictEqual({ revoked: true });
    await expect(opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
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

  it("closes every session's socket at a password reset", async () => {
    const email = "socket-session-reset@example.test";
    const tab = await signedInTab(email);
    const { ticket } = await v1Link(phoneHeaders(await signInPhone(email))).account.socketTicket();
    const phone = await openWithTicket(ticket);
    const reset = await drained(
      exports.default.fetch(`${ORIGIN}/api/auth/reset-password`, {
        body: JSON.stringify({ newPassword: "new-password-5678", token: await issueToken(email) }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      }),
    );
    expect(reset.status).toBe(200);
    await expect(tab.opened.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
    await expect(phone.closed).resolves.toBe(SOCKET_REVOKED_CLOSE_CODE);
  });

  it("closes its sockets at a deletion's tombstone, and refuses another while a session still stands", async () => {
    const { accountId, ticket } = await signedInPhone("socket-deleted@example.test");
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
    const { accountId, ticket } = await signedInPhone("socket-evicted@example.test");
    const opened = await openWithTicket(ticket);
    await evictDurableObject(cellOf(accountId), { webSockets: "hibernate" });
    const written = await writeInCell(accountId);
    await until(() => opened.frames.length > 0);
    expect(opened.frames).toStrictEqual(itemWritten(written));
  });
});

const movedOf = (opened: OpenSocket) => opened.frames.filter((frame) => frame.type === "moved");

const itemRowSchema = z.object({ id: z.string(), seq: z.number() });

describe("the moved frame", () => {
  it("names what a person's write moved, once a write, and nothing for an answer given again", async () => {
    const { phone, ticket } = await signedInPhone("moved-person@example.test");
    const opened = await openWithTicket(ticket);
    const { library } = v1Link(phoneHeaders(phone));
    const opId = crypto.randomUUID();
    const { item } = await library.items.createNote({ markdown: "Paris.", opId });
    await until(() => movedOf(opened).length === 1);
    expect(movedOf(opened)).toStrictEqual([
      { folders: false, items: [{ id: item.id, seq: item.seq }], threads: [], type: "moved" },
    ]);
    // the resend is answered from its op's record, and moved nothing
    await library.items.createNote({ markdown: "Paris.", opId });
    const folderId = uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));
    await library.folders.write({
      ops: [{ id: folderId, name: "Trips", op: "create", parentId: null, sort: "a0" }],
    });
    await until(() => movedOf(opened).length === 2);
    expect(movedOf(opened)[1]).toStrictEqual({
      folders: true,
      items: [],
      threads: [],
      type: "moved",
    });
  });

  it("names what an assistant's tool moved", async () => {
    const { cookie } = await signUpUser("moved-connector@example.test");
    const accountId = await userIdOf(cookie);
    const { ticket } = await v1Link(sessionHeaders(cookie)).account.socketTicket();
    const opened = await openWithTicket(ticket);
    const assistant = await connectAssistant(cookie);
    const client = await connectorClient(assistant.access_token);
    await client.callTool({ arguments: { markdown: "Rome." }, name: "create_note" });
    await client.close();
    await until(() => movedOf(opened).length === 1);
    const [row] = await inCell(cellOf(accountId), (state) =>
      state.storage.sql.exec("SELECT id, seq FROM items").toArray(),
    );
    expect(movedOf(opened)).toStrictEqual([
      { folders: false, items: [itemRowSchema.parse(row)], threads: [], type: "moved" },
    ]);
  });

  it(
    "names the thread a turn of the built-in agent moved, and the items its tools wrote",
    { timeout: 30_000 },
    async () => {
      const { accountId, ticket } = await signedInPhone("moved-agent@example.test");
      const opened = await openWithTicket(ticket);
      const account = { accountId, cell: cellOf(accountId) };
      const sent = await asLaptop(
        account,
        async (client) =>
          await client.agent.send({ text: script('call create_note {"markdown":"Oslo."}') }),
      );
      await settled(account, sent.threadId);
      const [note] = await cellRows(account, "SELECT id, seq FROM items");
      const { id } = itemRowSchema.parse(note);
      await until(() =>
        movedOf(opened).some(
          (frame) => frame.items !== "all" && frame.items.some((moved) => moved.id === id),
        ),
      );
      const moved = movedOf(opened);
      expect(moved.every((frame) => frame.threads !== "all")).toBe(true);
      expect(
        moved.some((frame) => frame.threads !== "all" && frame.threads.includes(sent.threadId)),
      ).toBe(true);
    },
  );

  it("names the item a reading of its page landed on", async () => {
    const { accountId, phone, ticket } = await signedInPhone("moved-fill@example.test");
    const opened = await openWithTicket(ticket);
    const url = "https://pages.example/moved";
    const { library } = v1Link(phoneHeaders(phone));
    const saved = await library.items.saveLink({ url });
    await until(() => movedOf(opened).length === 1);
    await cellOf(accountId).landFill({
      itemId: saved.item.id,
      kind: "failed",
      sentence: "The page took too long to answer.",
      url,
    });
    await until(() => movedOf(opened).length === 2);
    const { seq } = await library.items.get({ id: saved.item.id });
    expect(movedOf(opened)[1]).toStrictEqual({
      folders: false,
      items: [{ id: saved.item.id, seq }],
      threads: [],
      type: "moved",
    });
  });

  it("names what an undo took back", async () => {
    const { phone, ticket } = await signedInPhone("moved-undo@example.test");
    const opened = await openWithTicket(ticket);
    const { library } = v1Link(phoneHeaders(phone));
    const { item } = await library.items.createNote({ markdown: "Before." });
    const { changeSets } = await library.history.list({});
    await library.history.undo({ changeSetIds: changeSets.map((set) => set.id) });
    await until(() => movedOf(opened).length === 2);
    const [, undone] = movedOf(opened);
    expect(undone).toMatchObject({ folders: false, threads: [], type: "moved" });
    expect(undone?.items).toStrictEqual([{ id: item.id, seq: expect.any(Number) }]);
  });

  it("says everything moved once the alarm's import landed its pages", async () => {
    const { accountId, ticket } = await signedInPhone("moved-import@example.test");
    const opened = await openWithTicket(ticket);
    const started = await startImport(
      accountId,
      { bytes: new TextEncoder().encode(RAINDROP_EXPORT), mime: "text/csv" },
      "raindrop",
      true,
    );
    await runAlarmsUntil(cellOf(accountId), ended(accountId, started.jobId));
    await until(() => movedOf(opened).length > 0);
    expect(movedOf(opened)).toContainEqual({
      folders: true,
      items: "all",
      threads: "all",
      type: "moved",
    });
  });
});
