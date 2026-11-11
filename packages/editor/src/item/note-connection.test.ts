// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { NOTE_SOCKET, notePath } from "@repo/contract/library/library-socket";

import { deferred } from "@repo/editor/deferred";
import type { NoteHost } from "@repo/editor/host-io";
import {
  DOWN_GRACE_MS,
  PING_EVERY_MS,
  PONG_WITHIN_MS,
  REDIAL_MS,
  noteConnection,
} from "@repo/editor/item/note-connection";
import type { NoteConnection, NoteEdits, NoteStatus } from "@repo/editor/item/note-connection";

import { noteServer } from "../test-support/note-server";
import type { NoteServer } from "../test-support/note-server";

// the provider's longest wait between dials
const BACKOFF_MS = 2500;

interface TestHost extends NoteHost {
  readonly goOffline: (offline: boolean) => void;
  readonly tickets: () => number;
}

// the cloud a note dials, an origin apart from the page's own location
const CLOUD = "https://notes.test";

const testHost = ({
  failTickets = 0,
  socketOrigin = CLOUD,
}: { readonly failTickets?: number; readonly socketOrigin?: string } = {}): TestHost => {
  const listeners = new Set<() => void>();
  let offline = false;
  let asked = 0;
  return {
    goOffline: (next) => {
      offline = next;
      for (const listener of listeners) {
        listener();
      }
    },
    notePath,
    offline: () => offline,
    onOfflineChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    socketOrigin,
    socketTicket: async () => {
      asked += 1;
      if (asked <= failTickets) {
        throw new Error("no ticket");
      }
      return await Promise.resolve(`ticket-${String(asked)}`);
    },
    tickets: () => asked,
  };
};

// runs whatever the sockets and the provider have queued, and the timers due in `ms`
const pass = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
};

const opened = (status: NoteStatus) => {
  if (status.kind !== "open") {
    throw new Error(`the note is ${status.kind}`);
  }
  return status;
};

const LIVE: NoteEdits = { kind: "live" };
const OFFLINE: NoteEdits = { kind: "offline" };
const FRESH: NoteStatus = { kind: "opening", stalled: false };

const editsOf = (note: NoteConnection): NoteEdits => opened(note.status()).edits;

const textOf = (doc: Y.Doc): string => doc.getText("probe").toJSON();

let server: NoteServer;
let connection: NoteConnection | null = null;

const openNote = (itemId: string, host: NoteHost): NoteConnection => {
  connection = noteConnection(itemId, host);
  connection.start();
  return connection;
};

const connect = async (host: NoteHost, itemId = "n1"): Promise<NoteConnection> => {
  const note = openNote(itemId, host);
  await pass();
  return note;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockReturnValue();
  server = noteServer();
  server.note("n1").doc.getText("probe").insert(0, "held");
});

afterEach(() => {
  connection?.close();
  connection = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a note's live document over its socket", () => {
  it("opens on the note's own document once it has synced, writing nothing", async () => {
    const note = openNote("n1", testHost());
    expect(note.status()).toStrictEqual(FRESH);
    const before = Y.encodeStateVector(server.note("n1").doc);
    await pass();
    const status = opened(note.status());
    expect(status).toMatchObject({ edits: LIVE, unsent: false });
    expect(textOf(status.doc)).toBe("held");
    expect(Y.encodeStateVector(server.note("n1").doc)).toStrictEqual(before);
    expect(server.awarenessFrames()).toBe(0);
    expect(server.sockets[0]?.binaryType).toBe("arraybuffer");
    expect(server.sockets[0]?.url).toMatch(/^wss:\/\/notes\.test\/v1\/notes\/n1\?/u);
  });

  it("dials the cloud the host names, by its scheme, and never the page's own location", async () => {
    openNote("n1", testHost({ socketOrigin: "http://127.0.0.1:8787" }));
    await pass();
    expect(location.origin).toBe("http://localhost:3000");
    expect(server.sockets.map(({ url }) => url.split("?")[0])).toStrictEqual([
      "ws://127.0.0.1:8787/v1/notes/n1",
    ]);
  });

  it("dials each time with a ticket asked for then, and carries edits both ways", async () => {
    const host = testHost();
    const note = await connect(host);
    expect(server.sockets[0]?.ticket).toBe("ticket-1");
    server.drop();
    await pass(BACKOFF_MS);
    expect(server.sockets.map((socket) => socket.ticket)).toStrictEqual(["ticket-1", "ticket-2"]);
    const { doc } = opened(note.status());
    doc.getText("probe").insert(0, "mine ");
    server.note("n1").doc.getText("probe").insert(9, " theirs");
    await pass();
    expect(textOf(server.note("n1").doc)).toBe("mine held theirs");
    expect(textOf(doc)).toBe("mine held theirs");
  });

  it("dials again when no ticket could be had", async () => {
    const host = testHost({ failTickets: 2 });
    const note = await connect(host);
    expect(note.status()).toStrictEqual(FRESH);
    await pass(REDIAL_MS);
    expect(note.status()).toStrictEqual(FRESH);
    await pass(REDIAL_MS);
    expect(editsOf(note)).toStrictEqual(LIVE);
    expect(host.tickets()).toBe(3);
  });

  it("is missing for a note that is not there, and dials no more", async () => {
    server.answer = "missing";
    const note = await connect(testHost());
    expect(note.status()).toStrictEqual({ kind: "missing" });
    await pass(BACKOFF_MS * 4);
    expect(server.sockets).toHaveLength(1);
    await expect(note.whenSaved()).resolves.toBe(false);
  });

  it("stays writable through a blip, and turns read-only once a socket is down 3 s", async () => {
    const note = await connect(testHost());
    server.answer = "hang";
    server.drop();
    await pass(DOWN_GRACE_MS - 1);
    expect(editsOf(note)).toStrictEqual(LIVE);
    await pass(1);
    expect(editsOf(note)).toStrictEqual(OFFLINE);
    server.answer = "open";
    const hung = server.sockets.at(-1);
    hung?.ended(1006);
    await pass(BACKOFF_MS);
    expect(editsOf(note)).toStrictEqual(LIVE);
  });

  it("turns read-only at once when the host goes offline, and dials at once when it is back", async () => {
    const host = testHost();
    const note = await connect(host);
    host.goOffline(true);
    expect(editsOf(note)).toStrictEqual(OFFLINE);
    server.answer = "refuse";
    server.drop();
    await pass(BACKOFF_MS * 2);
    const dials = server.sockets.length;
    server.answer = "open";
    host.goOffline(false);
    await pass();
    expect(server.sockets).toHaveLength(dials + 1);
    expect(editsOf(note)).toStrictEqual(LIVE);
  });

  it("pings every 20 s, and dials again when no answer comes within 5 s", async () => {
    const note = await connect(testHost());
    const [first] = server.sockets;
    await pass(PING_EVERY_MS);
    expect(first?.texts).toStrictEqual([NOTE_SOCKET.ping]);
    server.answersPings = false;
    await pass(PING_EVERY_MS);
    expect(first?.readyState).toBe(WebSocket.OPEN);
    await pass(PONG_WITHIN_MS);
    expect(first?.readyState).toBe(WebSocket.CLOSED);
    expect(editsOf(note)).toStrictEqual(LIVE);
    server.answersPings = true;
    await pass(BACKOFF_MS);
    expect(server.open()).toHaveLength(1);
    expect(editsOf(note)).toStrictEqual(LIVE);
  });

  it("dials a fresh socket over the same document when a quiet one never says it closed", async () => {
    const note = await connect(testHost());
    const { doc } = opened(note.status());
    const [first] = server.sockets;
    if (first === undefined) {
      throw new Error("a socket");
    }
    server.silence(first);
    await pass(PING_EVERY_MS);
    await pass(PONG_WITHIN_MS);
    expect(first.readyState).toBe(WebSocket.CLOSING);
    expect(server.open()).toHaveLength(1);
    expect(server.open()[0]).not.toBe(first);
    expect(opened(note.status())).toMatchObject({ doc, edits: LIVE });
    doc.getText("probe").insert(0, "still ");
    await pass();
    expect(textOf(server.note("n1").doc)).toBe("still held");
  });

  it("probes at once when the page is shown again or the connection is back", async () => {
    await connect(testHost());
    const [first] = server.sockets;
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    await pass();
    expect(first?.texts).toStrictEqual([NOTE_SOCKET.ping, NOTE_SOCKET.ping]);
    server.answer = "refuse";
    server.drop();
    await pass(BACKOFF_MS);
    const dials = server.sockets.length;
    server.answer = "open";
    window.dispatchEvent(new Event("online"));
    await pass();
    expect(server.sockets).toHaveLength(dials + 1);
    expect(server.open()).toHaveLength(1);
  });

  it("holds a note in Deleted read-only, and lets it go once a restore reopens it", async () => {
    server.note("n1").greeting = NOTE_SOCKET.deleted;
    const note = await connect(testHost());
    expect(editsOf(note)).toStrictEqual({ held: "deleted", kind: "held" });
    server.note("n1").greeting = null;
    server.drop(4409);
    await pass(BACKOFF_MS);
    expect(editsOf(note)).toStrictEqual(LIVE);
    server.say("n1", NOTE_SOCKET.deleted);
    await pass();
    expect(editsOf(note)).toStrictEqual({ held: "deleted", kind: "held" });
  });

  it("drops a full note's document for the note's own, showing the old one read-only meanwhile", async () => {
    const note = await connect(testHost());
    const before = opened(note.status()).doc;
    server.answer = "hang";
    server.note("n1").greeting = NOTE_SOCKET.full;
    server.say("n1", NOTE_SOCKET.full);
    await pass();
    expect(opened(note.status())).toMatchObject({
      doc: before,
      edits: { held: "full", kind: "held" },
    });
    server.answer = "open";
    server.sockets.at(-1)?.ended(1006);
    await pass(BACKOFF_MS);
    const after = opened(note.status());
    expect(after.edits).toStrictEqual({ held: "full", kind: "held" });
    expect(after.doc).not.toBe(before);
    expect(textOf(after.doc)).toBe("held");
    const dials = server.sockets.length;
    await pass(BACKOFF_MS * 4);
    expect(server.sockets).toHaveLength(dials);
  });

  it("drops the document a refused frame was in, and what it held with it", async () => {
    const note = await connect(testHost());
    const before = opened(note.status()).doc;
    const [socket] = server.open();
    if (socket === undefined) {
      throw new Error("an open socket");
    }
    server.refuse(socket);
    before.getText("probe").insert(0, "too much ");
    const saved = note.whenSaved();
    await pass(BACKOFF_MS);
    await expect(saved).resolves.toBe(false);
    const after = opened(note.status());
    expect(after.doc).not.toBe(before);
    expect(after.edits).toStrictEqual(LIVE);
    expect(textOf(after.doc)).toBe("held");
    expect(textOf(server.note("n1").doc)).toBe("held");
  });

  it("answers whenSaved once the note says it stored every edit made before the ask", async () => {
    const note = await connect(testHost());
    await expect(note.whenSaved()).resolves.toBe(true);
    expect(server.sockets[0]?.texts).toStrictEqual([]);
    const { doc } = opened(note.status());
    doc.getText("probe").insert(0, "a");
    await expect(Promise.all([note.whenSaved(), pass()])).resolves.toStrictEqual([true, undefined]);
    expect(server.sockets[0]?.texts).toStrictEqual([`__YPS:${NOTE_SOCKET.savedAsk}`]);
    await expect(note.whenSaved()).resolves.toBe(true);
  });

  it("asks again after a drop, once the edits made meanwhile went with the sync", async () => {
    const note = await connect(testHost());
    const { doc } = opened(note.status());
    server.answersSaved = false;
    doc.getText("probe").insert(0, "a");
    let saved: boolean | null = null;
    void note.whenSaved().then((answer) => {
      saved = answer;
    });
    await pass();
    expect(saved).toBeNull();
    server.answer = "hang";
    server.drop();
    doc.getText("probe").insert(0, "b");
    await pass(BACKOFF_MS);
    expect(saved).toBeNull();
    server.answer = "open";
    server.answersSaved = true;
    server.sockets.at(-1)?.ended(1006);
    await pass(BACKOFF_MS);
    expect(saved).toBe(true);
    expect(textOf(server.note("n1").doc)).toBe("baheld");
  });

  it("says an edit made while no socket carried it is unsent, until the next sync hands it over", async () => {
    const note = await connect(testHost());
    const { doc } = opened(note.status());
    let heard = 0;
    note.subscribe(() => {
      heard += 1;
    });
    doc.getText("probe").insert(0, "sent ");
    await pass();
    expect(opened(note.status()).unsent).toBe(false);
    server.answer = "hang";
    server.drop();
    await pass();
    expect(opened(note.status()).unsent).toBe(false);
    doc.getText("probe").insert(0, "typed ");
    expect(opened(note.status()).unsent).toBe(true);
    const turned = heard;
    expect(turned).toBeGreaterThan(0);
    server.answer = "open";
    server.sockets.at(-1)?.ended(1006);
    await pass(BACKOFF_MS);
    expect(opened(note.status()).unsent).toBe(false);
    expect(heard).toBeGreaterThan(turned);
    expect(textOf(server.note("n1").doc)).toBe("typed sent held");
  });

  it("opens no socket when it closes while its ticket is asked for", async () => {
    const ticket = deferred<string>();
    const host: NoteHost = { ...testHost(), socketTicket: async () => await ticket.promise };
    const note = openNote("n1", host);
    note.close();
    ticket.resolve("late");
    await pass(BACKOFF_MS * 2);
    expect(server.open()).toStrictEqual([]);
  });

  it("opens afresh when it starts again after a close, as a remount does", async () => {
    const note = await connect(testHost());
    const before = opened(note.status()).doc;
    note.close();
    expect(note.status()).toStrictEqual(FRESH);
    note.start();
    expect(note.status()).toStrictEqual(FRESH);
    await pass();
    const after = opened(note.status());
    expect(after.edits).toStrictEqual(LIVE);
    expect(after.doc).not.toBe(before);
    expect(server.open()).toHaveLength(1);
  });

  it("answers whenSaved false once the note holds every edit back, which it answers no ask for", async () => {
    const note = await connect(testHost());
    server.answersSaved = false;
    opened(note.status()).doc.getText("probe").insert(0, "a");
    const saved = note.whenSaved();
    await pass();
    server.note("n1").greeting = NOTE_SOCKET.deleted;
    server.say("n1", NOTE_SOCKET.deleted);
    await pass();
    await expect(saved).resolves.toBe(false);
    await expect(note.whenSaved()).resolves.toBe(false);
  });

  it("answers whenSaved false when the note closes first", async () => {
    const note = await connect(testHost());
    server.answersSaved = false;
    opened(note.status()).doc.getText("probe").insert(0, "a");
    const saved = note.whenSaved();
    await pass();
    note.close();
    await expect(saved).resolves.toBe(false);
    await expect(note.whenSaved()).resolves.toBe(false);
  });

  it("asks no ticket and dials nothing while the host is offline, and dials once when it is back", async () => {
    const host = testHost();
    const note = await connect(host);
    host.goOffline(true);
    await pass();
    expect(server.open()).toStrictEqual([]);
    const dials = server.sockets.length;
    const tickets = host.tickets();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pageshow"));
    await pass(BACKOFF_MS * 8);
    expect(server.sockets).toHaveLength(dials);
    expect(host.tickets()).toBe(tickets);
    expect(editsOf(note)).toStrictEqual(OFFLINE);
    host.goOffline(false);
    await pass();
    expect(server.sockets).toHaveLength(dials + 1);
    expect(host.tickets()).toBe(tickets + 1);
    expect(editsOf(note)).toStrictEqual(LIVE);
  });

  it("opens stalled with the host offline, stays stalled once it is back, and opens on the sync", async () => {
    const host = testHost();
    host.goOffline(true);
    const note = openNote("n1", host);
    await pass(BACKOFF_MS * 4);
    expect(note.status()).toStrictEqual({ kind: "opening", stalled: true });
    expect(server.sockets).toStrictEqual([]);
    expect(host.tickets()).toBe(0);
    server.answer = "hang";
    host.goOffline(false);
    await pass();
    expect(server.sockets).toHaveLength(1);
    expect(note.status()).toStrictEqual({ kind: "opening", stalled: true });
    server.answer = "open";
    server.sockets[0]?.ended(1006);
    await pass(BACKOFF_MS);
    expect(editsOf(note)).toStrictEqual(LIVE);
  });

  it("stalls a note no socket reaches within the grace, though the host is online", async () => {
    server.answer = "hang";
    const note = await connect(testHost());
    await pass(DOWN_GRACE_MS - 1);
    expect(note.status()).toStrictEqual(FRESH);
    await pass(1);
    expect(note.status()).toStrictEqual({ kind: "opening", stalled: true });
  });

  it("says the note refused a frame too large for it, and never that it needs a connection", async () => {
    const note = await connect(testHost());
    const [socket] = server.open();
    if (socket === undefined) {
      throw new Error("an open socket");
    }
    server.answer = "hang";
    server.refuse(socket);
    await pass(DOWN_GRACE_MS * 2);
    expect(editsOf(note)).toStrictEqual({ kind: "refused" });
    server.answer = "open";
    server.sockets.at(-1)?.ended(1006);
    await pass(BACKOFF_MS);
    expect(editsOf(note)).toStrictEqual(LIVE);
  });

  it("answers whenSaved asked while a refused document is dropped, and asks afresh once it is", async () => {
    const note = await connect(testHost());
    server.answersSaved = false;
    opened(note.status()).doc.getText("probe").insert(0, "too much ");
    const [socket] = server.open();
    if (socket === undefined) {
      throw new Error("an open socket");
    }
    server.answer = "hang";
    server.refuse(socket);
    await pass();
    await expect(note.whenSaved()).resolves.toBe(false);
    server.answer = "open";
    server.sockets.at(-1)?.ended(1006);
    await pass(BACKOFF_MS);
    await expect(note.whenSaved()).resolves.toBe(true);
  });

  it("is missing with nothing unsent once the note goes for good after an edit no socket carried", async () => {
    const note = await connect(testHost());
    server.answer = "hang";
    server.drop();
    await pass();
    opened(note.status()).doc.getText("probe").insert(0, "typed ");
    expect(opened(note.status()).unsent).toBe(true);
    server.answer = "missing";
    server.sockets.at(-1)?.ended(1006);
    await pass(BACKOFF_MS);
    expect(note.status()).toStrictEqual({ kind: "missing" });
  });

  it("takes edits again once a full note reopens its socket", async () => {
    server.note("n1").greeting = NOTE_SOCKET.full;
    const note = await connect(testHost());
    expect(editsOf(note)).toStrictEqual({ held: "full", kind: "held" });
    server.note("n1").greeting = null;
    server.drop(NOTE_SOCKET.reopenCode);
    await pass(BACKOFF_MS);
    expect(editsOf(note)).toStrictEqual(LIVE);
  });

  it("says a held note is held while its socket is down or the host is offline", async () => {
    server.note("n1").greeting = NOTE_SOCKET.deleted;
    const host = testHost();
    const note = await connect(host);
    server.answer = "hang";
    server.drop();
    await pass(DOWN_GRACE_MS * 2);
    expect(editsOf(note)).toStrictEqual({ held: "deleted", kind: "held" });
    host.goOffline(true);
    expect(editsOf(note)).toStrictEqual({ held: "deleted", kind: "held" });
  });

  it("confirms nothing by an answer to no ask", async () => {
    const note = await connect(testHost());
    server.answersSaved = false;
    opened(note.status()).doc.getText("probe").insert(0, "a");
    server.say("n1", NOTE_SOCKET.saved);
    await pass();
    let saved: boolean | null = null;
    void note.whenSaved().then((answer) => {
      saved = answer;
    });
    await pass();
    expect(saved).toBeNull();
    note.close();
    await pass();
    expect(saved).toBe(false);
  });
});
