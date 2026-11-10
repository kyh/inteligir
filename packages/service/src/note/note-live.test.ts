import { NOTE_SOCKET, notePath, SOCKET_TICKET_PARAM } from "@repo/contract/library/library-socket";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { noteMeta, noteUpdates } from "@repo/db/note/schema";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { applyBodyChanges } from "@repo/editor/live/body-change";
import type { BodyChange } from "@repo/editor/live/body-change";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import { noteRoot, yjsBindingPlugin } from "@repo/editor/live/yjs-binding";
import { YjsEditor } from "@slate-yjs/core";
import { abortAllDurableObjects, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";
import YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { z } from "zod";

import {
  ORIGIN,
  phoneHeaders,
  sessionHeaders,
  signInPhone,
  signOutPhone,
  signUpUser,
  userIdOf,
  v1Link,
} from "../test-support/cloud-helpers";
import {
  FetchWebSocket,
  holdSends,
  opens,
  releaseSends,
  traces,
} from "../test-support/fetch-web-socket";
import { runAlarmsUntil } from "../test-support/library-files";
import { cellOf } from "../test-support/library-cell";
import { NOTE_STATE_CAP, NOTE_UPDATE_CAP } from "./note-do";
import { noteDbOf } from "./note-db";
import { noteStub } from "./note-stub";
import { noteBlocksSchema, NOTE_HOLDER_HEADER, NOTE_MODE_HEADER } from "./note-wire";

const until = async (check: () => boolean | Promise<boolean>, tries = 300): Promise<void> => {
  for (let tried = 0; tried < tries && !(await check()); tried += 1) {
    await scheduler.wait(10);
  }
  const done = await check();
  expect(done).toBe(true);
};

const X_TEXT = "The quick brown fox jumps over the lazy dog.";
const MARKDOWN = `Above the fox.\n\n${X_TEXT}\n\nBelow the fox.`;

// a person signed in on the site, the account's id and a fresh ticket for each socket
const signedIn = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const link = v1Link(sessionHeaders(cookie));
  const ticket = async (): Promise<string> => {
    const minted = await link.account.socketTicket();
    return minted.ticket;
  };
  const { item } = await link.library.items.createNote({ markdown: MARKDOWN });
  const accountId = await userIdOf(cookie);
  return { accountId, cookie, itemId: item.id, library: link.library, ticket };
};

interface Client {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly provider: YProvider;
  readonly messages: string[];
}

const openClient = async (
  itemId: string,
  ticket: () => Promise<string>,
  id: string,
  synced = true,
): Promise<Client> => {
  const doc = new Y.Doc();
  const provider = new YProvider(ORIGIN, itemId, doc, {
    connect: false,
    connectionId: id,
    disableBc: true,
    params: async () => ({ [SOCKET_TICKET_PARAM]: await ticket() }),
    prefix: notePath(itemId),
    WebSocketPolyfill: FetchWebSocket,
  });
  // presence off, as every device runs it
  provider.awareness.setLocalState(null);
  const messages: string[] = [];
  provider.on("custom-message", (message: string) => {
    messages.push(message);
  });
  await provider.connect();
  if (synced) {
    await until(() => provider.synced);
  }
  return { doc, id, messages, provider };
};

const leafText = (block: LibraryBlock): string =>
  block.children.map((child) => ("text" in child ? child.text : "")).join("");

const textOf = (blocks: readonly BodyBlock[]): string[] =>
  blocks.map(({ block }) => leafText(block));

const clientText = (client: Client): string[] => textOf(readBlocks(client.doc));

const noteOf = (accountId: string, itemId: string) => noteStub(exports, { accountId, itemId });

const serverBlocks = async (accountId: string, itemId: string): Promise<BodyBlock[]> => {
  const read = await noteOf(accountId, itemId).read();
  return noteBlocksSchema.parse(read.blocks);
};

const serverText = async (accountId: string, itemId: string): Promise<string[]> =>
  textOf(await serverBlocks(accountId, itemId));

const serverLine = async (
  accountId: string,
  itemId: string,
  index: number,
): Promise<string | undefined> => {
  const text = await serverText(accountId, itemId);
  return text[index];
};

const serverIds = async (accountId: string, itemId: string): Promise<string[]> => {
  const blocks = await serverBlocks(accountId, itemId);
  return blocks.map(({ block }) => block.id);
};

const converged = async (
  accountId: string,
  itemId: string,
  clients: readonly Client[],
): Promise<boolean> => {
  const server = JSON.stringify(await serverText(accountId, itemId));
  return clients.every((client) => JSON.stringify(clientText(client)) === server);
};

const rootPartsSchema = z.array(z.object({ insert: z.unknown() }));

// a person's typing: the text inserted into a block's own Y text, as the editor's binding writes it
const typeInto = (client: Client, blockIndex: number, offset: number, text: string): void => {
  const part = rootPartsSchema.parse(noteRoot(client.doc).toDelta())[blockIndex]?.insert;
  if (!(part instanceof Y.XmlText)) {
    throw new TypeError(`no block at ${String(blockIndex)}`);
  }
  part.insert(offset, text);
};

// an edit by block id through an editor bound to a client's document, as the note applies its own
const editAs = (client: Client, changes: readonly BodyChange[]): void => {
  const editor = createSlateEditor({
    plugins: [
      ...BASE_KIT,
      yjsBindingPlugin({ localOrigin: client.id, root: noteRoot(client.doc) }),
    ],
  });
  if (!YjsEditor.isYjsEditor(editor)) {
    throw new Error("the client's editor is not bound to its document");
  }
  editor.tf.withoutNormalizing(() => {
    YjsEditor.connect(editor);
  });
  try {
    expect(applyBodyChanges(editor, changes)).toStrictEqual({ kind: "applied" });
  } finally {
    YjsEditor.disconnect(editor);
  }
};

const blockAt = (blocks: readonly BodyBlock[], index: number): LibraryBlock => {
  const block = blocks[index]?.block;
  if (block === undefined) {
    throw new Error(`no block at ${String(index)}`);
  }
  return block;
};

const withText = (block: LibraryBlock, text: string): LibraryBlock =>
  block.type === "p" ? { ...block, children: [{ text }] } : block;

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

// an agent's put of a block as it read it, under its turn's change set
const agentPut = (
  changeSetId: string,
  before: LibraryBlock,
  after: LibraryBlock,
  opId = crypto.randomUUID(),
) => ({
  changeSetId,
  changes: [{ base: before, block: after, blockId: before.id, kind: "put" as const }],
  opId,
  origin: `agent:${changeSetId}`,
});

const randomLetters = (length: number): string =>
  String.fromCodePoint(
    ...crypto.getRandomValues(new Uint8Array(length)).map((byte) => 97 + (byte % 26)),
  );

const lettersOf = (length: number): string => {
  const parts: string[] = [];
  for (let made = 0; made < length; made += 50_000) {
    parts.push(randomLetters(Math.min(50_000, length - made)));
  }
  return parts.join("");
};

const dial = async (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  await exports.default.fetch(`${ORIGIN}${path}`, {
    headers: { upgrade: "websocket", ...headers },
  });

const status = async (path: string): Promise<number> => {
  const response = await dial(path);
  return response.status;
};

const textSchema = z.string();

// a socket dialed bare: the text frames it hears and the codes it closes with
const heard = (socket: WebSocket) => {
  const texts: string[] = [];
  const closes: number[] = [];
  socket.accept();
  socket.addEventListener("message", (event) => {
    const text = textSchema.safeParse(event.data);
    if (text.success) {
      texts.push(text.data);
    }
  });
  socket.addEventListener("close", (event) => {
    closes.push(event.code);
  });
  return { closes, texts };
};

const socketOf = (response: Response): WebSocket => {
  if (response.webSocket === null) {
    throw new Error(`no socket on a ${String(response.status)}`);
  }
  return response.webSocket;
};

const custom = (message: string): string => `__YPS:${message}`;

describe("a note edited live", () => {
  it("carries two devices' typing through its door, and the cell's search finds it within the save's debounce", async () => {
    const { accountId, itemId, library, ticket } = await signedIn("note-two@example.test");
    const a = await openClient(itemId, ticket, "two-a");
    const b = await openClient(itemId, ticket, "two-b");
    expect(clientText(a)).toStrictEqual(["Above the fox.", X_TEXT, "Below the fox."]);

    const typed = Date.now();
    typeInto(a, 0, 0, "Zanzibar ");
    await until(() => clientText(b)[0] === "Zanzibar Above the fox.");
    await until(async () => await converged(accountId, itemId, [a, b]));
    const found = async (): Promise<boolean> => {
      const page = await library.listing.page({
        limit: 10,
        query: { deleted: false, sort: "title" },
        words: "zanzibar",
      });
      return page.items.some(({ id }) => id === itemId);
    };
    await until(found, 700);
    expect(Date.now() - typed).toBeLessThan(6000);
    a.provider.destroy();
    b.provider.destroy();
  }, 20_000);

  it("drops presence: a device that publishes it reaches no other device", async () => {
    const { itemId, ticket } = await signedIn("note-presence@example.test");
    const quiet = await openClient(itemId, ticket, "presence-quiet");
    const loud = await openClient(itemId, ticket, "presence-loud");
    loud.provider.awareness.setLocalState({ name: "loud" });
    typeInto(loud, 0, 0, "x");
    await until(() => clientText(quiet)[0] === "xAbove the fox.");
    const awareness = (traces.get("presence-quiet")?.received ?? []).filter(
      (frame) => frame instanceof ArrayBuffer && new Uint8Array(frame)[0] === 1,
    );
    expect(awareness).toStrictEqual([]);
    expect(quiet.provider.awareness.getStates().size).toBe(0);
    quiet.provider.destroy();
    loud.provider.destroy();
  });

  it("keeps a person's typing under an agent's concurrent put, and its turn's undo after an eviction keeps every later edit", async () => {
    const { accountId, itemId, ticket } = await signedIn("note-put@example.test");
    const a = await openClient(itemId, ticket, "put-a");
    const b = await openClient(itemId, ticket, "put-b");
    const note = noteOf(accountId, itemId);
    const before = blockAt(await serverBlocks(accountId, itemId), 1);

    holdSends("put-a");
    typeInto(a, 1, 4, "very ");
    const put = await note.applyChange(
      agentPut("turn-1", before, withText(before, X_TEXT.replace("brown", "red"))),
    );
    expect(put.kind).toBe("applied");
    await until(() => clientText(a)[1]?.includes("red") === true);
    releaseSends("put-a");
    await until(async () => await converged(accountId, itemId, [a, b]));
    await expect(serverLine(accountId, itemId, 1)).resolves.toBe(
      "The very quick red fox jumps over the lazy dog.",
    );

    // the same read again, which the person's typing moved: refused with the block as it stands
    const stale = await note.applyChange(agentPut("turn-2", before, withText(before, "Gone.")));
    expect(stale).toMatchObject({ blocks: [{ block: { id: before.id } }], kind: "moved" });

    const now = clientText(a)[1] ?? "";
    typeInto(a, 1, now.indexOf("red") + 3, "dish");
    await until(async () => await converged(accountId, itemId, [a, b]));

    await evictDurableObject(note, { webSockets: "hibernate" });
    const undone = await note.undoTurn("turn-1", "undo-1");
    expect(undone).toMatchObject({ lostText: false, personEdited: true });
    expect(undone.projection).not.toBeNull();
    await until(async () => await converged(accountId, itemId, [a, b]));
    const after = (await serverLine(accountId, itemId, 1)) ?? "";
    expect(after).toContain("very ");
    expect(after).toContain("brown");
    expect(after).toContain("dish");
    expect(after).not.toContain("red");
    // a turn undone again changes nothing
    await expect(note.undoTurn("turn-1", "undo-2")).resolves.toMatchObject({ projection: null });
    a.provider.destroy();
    b.provider.destroy();
  });

  it("says an undo took text a person wrote inside a block the turn added", async () => {
    const { accountId, itemId, ticket } = await signedIn("note-lost@example.test");
    const a = await openClient(itemId, ticket, "lost-a");
    const note = noteOf(accountId, itemId);
    const first = blockAt(await serverBlocks(accountId, itemId), 0);
    const added = await note.applyChange({
      changeSetId: "turn-add",
      changes: [
        {
          afterId: first.id,
          block: paragraph("agentBlock", "The agent's line."),
          kind: "insertAfter",
          section: "note",
        },
      ],
      opId: crypto.randomUUID(),
      origin: "agent:turn-add",
    });
    expect(added.kind).toBe("applied");
    await until(() => clientText(a)[1] === "The agent's line.");
    typeInto(a, 1, 0, "mine ");
    await until(async () => (await serverLine(accountId, itemId, 1)) === "mine The agent's line.");

    const undone = await note.undoTurn("turn-add", "undo-add");
    expect(undone.lostText).toBe(true);
    await until(async () => await converged(accountId, itemId, [a]));
    await expect(serverText(accountId, itemId)).resolves.toStrictEqual([
      "Above the fox.",
      X_TEXT,
      "Below the fox.",
    ]);
    a.provider.destroy();
  });

  it("wakes from hibernation on a device's next frame, its sockets kept", async () => {
    const { accountId, itemId, ticket } = await signedIn("note-hibernate@example.test");
    const a = await openClient(itemId, ticket, "sleep-a");
    const b = await openClient(itemId, ticket, "sleep-b");
    typeInto(a, 0, 0, "1");
    await until(() => clientText(b)[0] === "1Above the fox.");
    await evictDurableObject(noteOf(accountId, itemId), { webSockets: "hibernate" });
    typeInto(a, 0, 0, "2");
    await until(() => clientText(b)[0] === "21Above the fox.");
    typeInto(b, 2, 0, "3");
    await until(() => clientText(a)[2] === "3Below the fox.");
    await until(async () => await converged(accountId, itemId, [a, b]));
    expect([opens.get("sleep-a"), opens.get("sleep-b")]).toStrictEqual([1, 1]);
    a.provider.destroy();
    b.provider.destroy();
  });

  it("keeps one copy of a block two devices moved at once", async () => {
    const { accountId, itemId, ticket } = await signedIn("note-dedupe@example.test");
    const a = await openClient(itemId, ticket, "move-a");
    const b = await openClient(itemId, ticket, "move-b");
    const blocks = await serverBlocks(accountId, itemId);
    const [above, x, below] = [blockAt(blocks, 0), blockAt(blocks, 1), blockAt(blocks, 2)];
    holdSends("move-a");
    holdSends("move-b");
    editAs(a, [{ afterId: null, base: x, blockId: x.id, kind: "move" }]);
    editAs(b, [{ afterId: below.id, base: x, blockId: x.id, kind: "move" }]);
    releaseSends("move-a");
    releaseSends("move-b");
    await until(async () => await converged(accountId, itemId, [a, b]));
    const ids = await serverIds(accountId, itemId);
    expect(ids.toSorted()).toStrictEqual([above.id, x.id, below.id].toSorted());
    a.provider.destroy();
    b.provider.destroy();
  });

  it("answers a ping without waking, and a device's ask before it closes once its frames are stored", async () => {
    const { itemId, ticket } = await signedIn("note-saved@example.test");
    const a = await openClient(itemId, ticket, "saved-a");
    typeInto(a, 0, 0, "kept ");
    a.provider.sendMessage(NOTE_SOCKET.savedAsk);
    await until(() => a.messages.includes(NOTE_SOCKET.saved));
    a.provider.destroy();

    const socket = socketOf(
      await dial(`${notePath(itemId)}?${SOCKET_TICKET_PARAM}=${await ticket()}`),
    );
    const { texts } = heard(socket);
    socket.send(NOTE_SOCKET.ping);
    await until(() => texts.includes(NOTE_SOCKET.pong));
    expect(texts).toContain(NOTE_SOCKET.pong);
    socket.close();
  });
});

describe("a note's door", () => {
  it("opens only on a ticket, and only its own account's notes", async () => {
    const mine = await signedIn("door-mine@example.test");
    const theirs = await signedIn("door-theirs@example.test");
    await expect(status(notePath(mine.itemId))).resolves.toBe(401);
    await expect(status(`${notePath(mine.itemId)}?${SOCKET_TICKET_PARAM}=nonsense`)).resolves.toBe(
      401,
    );
    await expect(
      status(`/v1/notes/not-an-id?${SOCKET_TICKET_PARAM}=${await mine.ticket()}`),
    ).resolves.toBe(404);

    const crossing = await dial(
      `${notePath(theirs.itemId)}?${SOCKET_TICKET_PARAM}=${await mine.ticket()}`,
    );
    expect(crossing.status).toBe(101);
    const { closes } = heard(socketOf(crossing));
    await until(() => closes.includes(NOTE_SOCKET.missingCode));
    expect(closes).toStrictEqual([NOTE_SOCKET.missingCode]);
    await expect(serverText(theirs.accountId, theirs.itemId)).resolves.toStrictEqual([
      "Above the fox.",
      X_TEXT,
      "Below the fox.",
    ]);
  });

  it("refuses an upgrade its door did not verify", async () => {
    const { accountId, itemId } = await signedIn("door-direct@example.test");
    const response = await noteOf(accountId, itemId).fetch(
      new Request(`https://note${notePath(itemId)}`, { headers: { upgrade: "websocket" } }),
    );
    expect(response.status).toBe(403);
  });

  it("opens a note in Deleted read-only whatever the client claims, and closes it for a reopen once restored", async () => {
    const { accountId, itemId, library, ticket } = await signedIn("door-deleted@example.test");
    const live = await openClient(itemId, ticket, "deleted-live");
    await library.items.delete({ ids: [itemId] });
    await until(() => live.messages.includes(NOTE_SOCKET.deleted));

    const forged = await dial(`${notePath(itemId)}?${SOCKET_TICKET_PARAM}=${await ticket()}`, {
      [NOTE_HOLDER_HEADER]: "someone-else",
      [NOTE_MODE_HEADER]: "live",
    });
    const socket = socketOf(forged);
    const { texts } = heard(socket);
    await until(() => texts.includes(custom(NOTE_SOCKET.deleted)));
    socket.close();

    const reader = await openClient(itemId, ticket, "deleted-reader");
    typeInto(reader, 0, 0, "ignored ");
    await scheduler.wait(100);
    await expect(serverLine(accountId, itemId, 0)).resolves.toBe("Above the fox.");

    await library.items.restore({ ids: [itemId] });
    await until(() => traces.get("deleted-live")?.closes.includes(NOTE_SOCKET.reopenCode) === true);
    expect(traces.get("deleted-live")?.closes[0]).toBe(NOTE_SOCKET.reopenCode);
    live.provider.destroy();
    reader.provider.destroy();
  });

  it("closes a session's note sockets as the session ends, and opens none on its ticket after", async () => {
    const { itemId } = await signedIn("door-sever@example.test");
    const owner = await signInPhone("door-sever@example.test");
    const phone = v1Link(phoneHeaders(owner));
    const ticket = async (): Promise<string> => {
      const minted = await phone.account.socketTicket();
      return minted.ticket;
    };
    const client = await openClient(itemId, ticket, "sever-phone");
    const unspent = await ticket();
    await signOutPhone(owner);
    await until(() => traces.get("sever-phone")?.closes.includes(NOTE_SOCKET.revokedCode) === true);
    client.provider.destroy();
    expect(traces.get("sever-phone")?.closes[0]).toBe(NOTE_SOCKET.revokedCode);
    await expect(status(`${notePath(itemId)}?${SOCKET_TICKET_PARAM}=${unspent}`)).resolves.toBe(
      401,
    );
  });

  it("closes every socket on a note deleted for good, which then opens on nothing", async () => {
    const { accountId, itemId, library, ticket } = await signedIn("door-purge@example.test");
    const a = await openClient(itemId, ticket, "purge-a");
    await library.items.delete({ ids: [itemId] });
    await library.items.purge({ ids: [itemId] });
    await runAlarmsUntil(
      cellOf(accountId),
      async () => traces.get("purge-a")?.closes.includes(NOTE_SOCKET.missingCode) === true,
    );
    a.provider.destroy();
    await expect(serverText(accountId, itemId)).resolves.toStrictEqual([]);
  });
});

describe("a note's size", () => {
  it("holds a device read-only past an update's size, and says why", async () => {
    const { accountId, itemId, ticket } = await signedIn("cap-update@example.test");
    const big = await openClient(itemId, ticket, "cap-big");
    const other = await openClient(itemId, ticket, "cap-other");
    typeInto(big, 0, 0, lettersOf(NOTE_UPDATE_CAP + 1024));
    await until(() => big.messages.includes(NOTE_SOCKET.refused));
    typeInto(big, 2, 0, "after ");
    await scheduler.wait(100);
    await expect(serverText(accountId, itemId)).resolves.toStrictEqual([
      "Above the fox.",
      X_TEXT,
      "Below the fox.",
    ]);
    expect(clientText(other)).toStrictEqual(["Above the fox.", X_TEXT, "Below the fox."]);
    big.provider.destroy();
    other.provider.destroy();
  }, 20_000);

  it("turns full past the note's size, every device told, and takes no agent edit", async () => {
    const { accountId, itemId, ticket } = await signedIn("cap-state@example.test");
    const writer = await openClient(itemId, ticket, "cap-writer");
    const watcher = await openClient(itemId, ticket, "cap-watcher");
    const chunk = Math.floor(NOTE_UPDATE_CAP * 0.9);
    const chunks = Math.ceil(NOTE_STATE_CAP / chunk) + 1;
    for (let sent = 0; sent < chunks && !watcher.messages.includes(NOTE_SOCKET.full); sent += 1) {
      typeInto(writer, 0, 0, lettersOf(chunk));
      await scheduler.wait(50);
    }
    await until(() => watcher.messages.includes(NOTE_SOCKET.full));
    await until(() => writer.messages.includes(NOTE_SOCKET.full));
    const before = blockAt(await serverBlocks(accountId, itemId), 1);
    const refused = await noteOf(accountId, itemId).applyChange(
      agentPut("turn-full", before, withText(before, "Too late.")),
    );
    expect(refused).toStrictEqual({ held: "full", kind: "held" });
    writer.provider.destroy();
    watcher.provider.destroy();
  }, 60_000);
});

describe("a note's first load", () => {
  it("seeds once while the cell reads it and devices open it at the same time", async () => {
    const { accountId, itemId, library, ticket } = await signedIn("seed-race@example.test");
    const note = noteOf(accountId, itemId);
    const [client, ...reads] = await Promise.all([
      openClient(itemId, ticket, "race-a"),
      note.read(),
      note.read(),
      library.items.get({ id: itemId }),
      note.read(),
    ]);
    expect(reads).toHaveLength(4);
    await expect(serverText(accountId, itemId)).resolves.toStrictEqual([
      "Above the fox.",
      X_TEXT,
      "Below the fox.",
    ]);
    // a call after an eviction starts the server itself, so it reads the note, not an empty one
    await evictDurableObject(note);
    await expect(serverText(accountId, itemId)).resolves.toStrictEqual([
      "Above the fox.",
      X_TEXT,
      "Below the fox.",
    ]);
    await until(async () => await converged(accountId, itemId, [client]));
    client.provider.destroy();
  });

  it("reads the seed again after an abort between the read and its persist", async () => {
    const { accountId, itemId } = await signedIn("seed-read@example.test");
    const cell = cellOf(accountId);
    await expect(cell.readSeed(itemId)).resolves.toMatchObject({ kind: "seed" });
    await expect(serverText(accountId, itemId)).resolves.toStrictEqual([
      "Above the fox.",
      X_TEXT,
      "Below the fox.",
    ]);
    await expect(cell.readSeed(itemId)).resolves.toStrictEqual({ kind: "claimed" });
  });

  it("confirms without reading the seed again after an abort between its persist and the confirm", async () => {
    const { accountId, itemId } = await signedIn("seed-persist@example.test");
    const cell = cellOf(accountId);
    const seed = await cell.readSeed(itemId);
    if (seed.kind !== "seed") {
      throw new Error("no seed");
    }
    const persisted = noteBlocksSchema.parse(seed.blocks).slice(0, 2);
    await runInDurableObject(noteOf(accountId, itemId), (_note, state) => {
      const doc = new Y.Doc();
      seedDoc(doc, persisted);
      const db = noteDbOf(state.storage);
      db.insert(noteUpdates)
        .values({ bytes: Y.encodeStateAsUpdate(doc) })
        .run();
      db.insert(noteMeta).values({ dirtyAt: Date.now(), id: 1, seedPending: 1, version: 1 }).run();
    });
    await expect(serverText(accountId, itemId)).resolves.toStrictEqual(["Above the fox.", X_TEXT]);
    await expect(cell.readSeed(itemId)).resolves.toStrictEqual({ kind: "claimed" });
  });
});

// last, since it aborts every object the suites' shared storage holds
describe("a note after every object was aborted", () => {
  it("undoes a turn from its stored rows alone", async () => {
    const { accountId, itemId } = await signedIn("note-abort@example.test");
    const note = noteOf(accountId, itemId);
    const before = blockAt(await serverBlocks(accountId, itemId), 2);
    await note.applyChange(agentPut("turn-abort", before, withText(before, "Rewritten.")));
    await abortAllDurableObjects();
    const undone = await noteOf(accountId, itemId).undoTurn("turn-abort", "undo-abort");
    expect(undone).toMatchObject({ lostText: false, personEdited: false });
    await expect(serverLine(accountId, itemId, 2)).resolves.toBe("Below the fox.");
  });
});
