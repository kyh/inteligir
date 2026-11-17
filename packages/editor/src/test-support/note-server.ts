// Notes' objects in memory, each a Y.Doc served over fake sockets that speak y-partyserver's wire:
// y-protocols' sync, the words beside it, and the ping an object answers without waking. A suite
// installs the server's socket as the page's WebSocket and drives the objects: refuse, drop or
// silence a socket, say a note is held, or that it is gone.

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { vi } from "vitest";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import { NOTE_SOCKET, noteWordFrame } from "@repo/contract/library/note-socket";

// y-partyserver's message types
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// a sync message as the object frames it
const syncFrame = (write: (encoder: encoding.Encoder) => void): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder).buffer;
};

// how the object answers a dial: opened, refused before the upgrade (a browser reads a plain
// failure), never answered, or opened and closed as a note that is not there
type DialAnswer = "open" | "refuse" | "hang" | "missing";

interface NoteObject {
  readonly doc: Y.Doc;
  // said to each socket as it opens, ahead of the sync: the note is held
  greeting: string | null;
}

export interface NoteServer {
  readonly sockets: readonly NoteSocket[];
  answer: DialAnswer;
  answersPings: boolean;
  answersSaved: boolean;
  // awareness frames received, which a device with presence off never sends
  readonly awarenessFrames: () => number;
  // the object of an item's note, made empty on first use
  readonly note: (itemId: string) => NoteObject;
  readonly open: (itemId?: string) => NoteSocket[];
  // a custom message to every open socket of the note
  readonly say: (itemId: string, message: string) => void;
  // holds a socket read-only: what it sends lands nothing, and the object says so
  readonly refuse: (socket: NoteSocket) => void;
  // a socket whose connection died unseen: nothing crosses it, and its close never completes
  readonly silence: (socket: NoteSocket) => void;
  // every open socket closed by the object, as a deploy or a lost connection closes them
  readonly drop: (code?: number) => void;
  readonly dialed: (socket: NoteSocket) => void;
  readonly received: (socket: NoteSocket, data: string | ArrayBufferView) => void;
}

let serving: NoteServer | null = null;

class NoteSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly OPEN = 1;
  readyState = NoteSocket.CONNECTING;
  binaryType = "blob";
  readonly url: string;
  // every text frame this socket sent, each a word in its frame
  readonly texts: string[] = [];
  silent = false;
  private readonly server: NoteServer;

  constructor(url: string) {
    super();
    if (serving === null) {
      throw new Error("no note server installed");
    }
    this.url = url;
    this.server = serving;
    serving.dialed(this);
  }

  get itemId(): string {
    return new URL(this.url).pathname.split("/").at(-1) ?? "";
  }

  get ticket(): string | null {
    return new URL(this.url).searchParams.get("ticket");
  }

  send(data: string | ArrayBufferView): void {
    if (this.readyState !== NoteSocket.OPEN) {
      return;
    }
    if (!ArrayBuffer.isView(data)) {
      this.texts.push(data);
    }
    // a frame sent before a close still arrives, as a browser sends what it buffered first
    queueMicrotask(() => {
      if (!this.silent) {
        this.server.received(this, data);
      }
    });
  }

  close(code = 1005): void {
    if (this.readyState >= NoteSocket.CLOSING) {
      return;
    }
    this.readyState = NoteSocket.CLOSING;
    if (this.silent) {
      return;
    }
    queueMicrotask(() => {
      this.ended(code);
    });
  }

  // the object's end of the socket

  opened(): void {
    this.readyState = NoteSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  deliver(data: string | ArrayBuffer): void {
    queueMicrotask(() => {
      if (this.readyState === NoteSocket.OPEN && !this.silent) {
        this.dispatchEvent(new MessageEvent("message", { data }));
      }
    });
  }

  ended(code: number): void {
    if (this.readyState === NoteSocket.CLOSED) {
      return;
    }
    const failed = this.readyState === NoteSocket.CONNECTING;
    this.readyState = NoteSocket.CLOSED;
    if (failed) {
      this.dispatchEvent(new Event("error"));
    }
    this.dispatchEvent(new CloseEvent("close", { code }));
  }
}

// a server installed as the page's WebSocket until the suite's globals are unstubbed
export const noteServer = (): NoteServer => {
  const sockets: NoteSocket[] = [];
  const notes = new Map<string, NoteObject>();
  const refusing = new Set<NoteSocket>();
  let awareness = 0;

  const open = (itemId?: string): NoteSocket[] =>
    sockets.filter(
      (socket) =>
        socket.readyState === NoteSocket.OPEN && (itemId === undefined || socket.itemId === itemId),
    );

  const note = (itemId: string): NoteObject => {
    const known = notes.get(itemId);
    if (known !== undefined) {
      return known;
    }
    const doc = new Y.Doc();
    doc.on("update", (update, origin) => {
      for (const socket of open(itemId)) {
        if (socket !== origin) {
          socket.deliver(
            syncFrame((encoder) => {
              sync.writeUpdate(encoder, update);
            }),
          );
        }
      }
    });
    const made: NoteObject = { doc, greeting: null };
    notes.set(itemId, made);
    return made;
  };

  const server: NoteServer = {
    answer: "open",
    answersPings: true,
    answersSaved: true,
    awarenessFrames: () => awareness,
    dialed: (socket) => {
      sockets.push(socket);
      const { answer } = server;
      queueMicrotask(() => {
        if (answer === "hang" || socket.readyState !== NoteSocket.CONNECTING) {
          return;
        }
        if (answer === "refuse") {
          socket.ended(1006);
          return;
        }
        const object = note(socket.itemId);
        socket.opened();
        if (answer === "missing") {
          socket.ended(NOTE_SOCKET.missingCode);
          return;
        }
        socket.deliver(
          syncFrame((encoder) => {
            sync.writeSyncStep1(encoder, object.doc);
          }),
        );
        if (object.greeting !== null) {
          socket.deliver(noteWordFrame(object.greeting));
        }
      });
    },
    drop: (code = 1006) => {
      for (const socket of open()) {
        socket.ended(code);
      }
    },
    note,
    open,
    received: (socket, data) => {
      if (!ArrayBuffer.isView(data)) {
        if (data === noteWordFrame(NOTE_SOCKET.ping) && server.answersPings) {
          socket.deliver(noteWordFrame(NOTE_SOCKET.pong));
        }
        // as the object, a socket held read-only is told nothing of what it sent
        const held = refusing.has(socket) || note(socket.itemId).greeting !== null;
        if (data === noteWordFrame(NOTE_SOCKET.savedAsk) && server.answersSaved && !held) {
          socket.deliver(noteWordFrame(NOTE_SOCKET.saved));
        }
        return;
      }
      const decoder = decoding.createDecoder(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
      const kind = decoding.readVarUint(decoder);
      if (kind === MESSAGE_AWARENESS) {
        awareness += 1;
        return;
      }
      // a socket held read-only has its step 1 answered still, and lands nothing it sends
      if (
        kind !== MESSAGE_SYNC ||
        (refusing.has(socket) && decoding.peekVarUint(decoder) !== sync.messageYjsSyncStep1)
      ) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      sync.readSyncMessage(decoder, encoder, note(socket.itemId).doc, socket);
      if (encoding.length(encoder) > 1) {
        socket.deliver(encoding.toUint8Array(encoder).buffer);
      }
    },
    refuse: (socket) => {
      refusing.add(socket);
      socket.deliver(noteWordFrame(NOTE_SOCKET.refused));
    },
    silence: (socket) => {
      socket.silent = true;
    },
    say: (itemId, message) => {
      for (const socket of open(itemId)) {
        socket.deliver(noteWordFrame(message));
      }
    },
    sockets,
  };
  serving = server;
  vi.stubGlobal("WebSocket", NoteSocket);
  return server;
};
