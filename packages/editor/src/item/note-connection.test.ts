// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { NoteHost } from "@repo/editor/host-io";
import {
  DOWN_GRACE_MS,
  NOTE_SOCKET,
  PING_EVERY_MS,
  PONG_WITHIN_MS,
  REDIAL_MS,
  openNote,
} from "@repo/editor/item/note-connection";
import type { NoteConnection, NoteStatus } from "@repo/editor/item/note-connection";

import { noteServer } from "../test-support/note-server";
import type { NoteServer } from "../test-support/note-server";

// the provider's longest wait between dials
const BACKOFF_MS = 2500;

interface TestHost extends NoteHost {
  readonly goOffline: (offline: boolean) => void;
  readonly tickets: () => number;
}

const testHost = ({ failTickets = 0 }: { readonly failTickets?: number } = {}): TestHost => {
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
    notePath: (itemId) => `/v1/notes/${itemId}`,
    offline: () => offline,
    onOfflineChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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

const textOf = (doc: Y.Doc): string => doc.getText("probe").toString();

let server: NoteServer;
let connection: NoteConnection | null = null;

const connect = async (host: NoteHost, itemId = "n1"): Promise<NoteConnection> => {
  connection = openNote(itemId, host);
  await pass();
  return connection;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockReturnValue(undefined);
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
    connection = note;
    expect(note.status()).toStrictEqual({ kind: "opening" });
    const before = Y.encodeStateVector(server.note("n1").doc);
    await pass();
    const status = opened(note.status());
    expect(status).toMatchObject({ held: null, live: true });
    expect(textOf(status.doc)).toBe("held");
    expect(Y.encodeStateVector(server.note("n1").doc)).toStrictEqual(before);
    expect(server.awarenessFrames()).toBe(0);
    expect(server.sockets[0]?.url).toMatch(/^ws:\/\/localhost:3000\/v1\/notes\/n1\?/u);
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
    expect(note.status()).toStrictEqual({ kind: "opening" });
    await pass(REDIAL_MS);
    expect(note.status()).toStrictEqual({ kind: "opening" });
    await pass(REDIAL_MS);
    expect(opened(note.status()).live).toBe(true);
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
    expect(opened(note.status()).live).toBe(true);
    await pass(1);
    expect(opened(note.status()).live).toBe(false);
    server.answer = "open";
    const hung = server.sockets.at(-1);
    hung?.ended(1006);
    await pass(BACKOFF_MS);
    expect(opened(note.status()).live).toBe(true);
  });

  it("turns read-only at once when the host goes offline, and dials at once when it is back", async () => {
    const host = testHost();
    const note = await connect(host);
    host.goOffline(true);
    expect(opened(note.status()).live).toBe(false);
    server.answer = "refuse";
    server.drop();
    await pass(BACKOFF_MS * 2);
    const dials = server.sockets.length;
    server.answer = "open";
    host.goOffline(false);
    await pass();
    expect(server.sockets).toHaveLength(dials + 1);
    expect(opened(note.status()).live).toBe(true);
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
    expect(opened(note.status()).live).toBe(true);
    server.answersPings = true;
    await pass(BACKOFF_MS);
    expect(server.open()).toHaveLength(1);
    expect(opened(note.status()).live).toBe(true);
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
    expect(opened(note.status())).toMatchObject({ held: "deleted", live: true });
    server.note("n1").greeting = null;
    server.drop(4409);
    await pass(BACKOFF_MS);
    expect(opened(note.status())).toMatchObject({ held: null, live: true });
    server.say("n1", NOTE_SOCKET.deleted);
    await pass();
    expect(opened(note.status()).held).toBe("deleted");
  });

  it("drops a full note's document for the note's own, showing the old one read-only meanwhile", async () => {
    const note = await connect(testHost());
    const before = opened(note.status()).doc;
    server.answer = "hang";
    server.note("n1").greeting = NOTE_SOCKET.full;
    server.say("n1", NOTE_SOCKET.full);
    await pass();
    expect(opened(note.status())).toMatchObject({ doc: before, held: "full", live: false });
    server.answer = "open";
    server.sockets.at(-1)?.ended(1006);
    await pass(BACKOFF_MS);
    const after = opened(note.status());
    expect(after).toMatchObject({ held: "full", live: true });
    expect(after.doc).not.toBe(before);
    expect(textOf(after.doc)).toBe("held");
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
    expect(after).toMatchObject({ held: null, live: true });
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
});
