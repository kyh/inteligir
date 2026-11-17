// An item's note over its own socket: one document kept in step with the note's object by
// y-protocols' sync, as y-partyserver's server speaks it, and the words the two say beside it. The
// socket is a live socket (`./live-socket`) at the note's path on the cloud's origin, on a ticket
// the host asks for, kept alive by the ping the object answers without waking. Each socket
// syncs afresh: this device's state goes as it opens and the note's answer brings what it lacks, an
// edit made here goes on the open socket, and one made while none is goes with the next sync.

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as sync from "y-protocols/sync";
import type * as Y from "yjs";

import {
  NOTE_SOCKET,
  notePath,
  noteWordFrame,
  socketUrl,
} from "@repo/contract/library/note-socket";
import type { Reach } from "@repo/editor/host-io";

import { createLiveSocket } from "./live-socket";
import type { Frame, LiveSocket, WebSocketClass } from "./live-socket";

export const PING_EVERY_MS = 20_000;
export const PONG_WITHIN_MS = 5000;
// the longest wait between dials, so a blip is back well inside the editor's grace
export const REDIAL_MOST_MS = 2500;

// y-partyserver's frame for a sync message; every other kind is presence, which is off
const MESSAGE_SYNC = 0;
const WORD = noteWordFrame("");

export type NoteSocketEvent =
  // a socket opened, or the open one closed
  | { readonly kind: "up" | "down" }
  // the document holds all the note does, as of this socket
  | { readonly kind: "synced" }
  // the library holds no such note, so nothing dials it again
  | { readonly kind: "gone" }
  | { readonly kind: "said"; readonly word: string };

export interface NoteSocketArgs {
  // the cloud's origin (`https://…`)
  readonly origin: string;
  readonly itemId: string;
  readonly doc: Y.Doc;
  readonly ticket: () => Promise<string>;
  readonly reach: Reach;
  readonly heard: (event: NoteSocketEvent) => void;
  readonly WebSocket?: WebSocketClass;
}

const UP: NoteSocketEvent = { kind: "up" };
const DOWN: NoteSocketEvent = { kind: "down" };
const SYNCED: NoteSocketEvent = { kind: "synced" };
const GONE: NoteSocketEvent = { kind: "gone" };

const syncFrame = (write: (encoder: encoding.Encoder) => void): Uint8Array<ArrayBuffer> => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
};

// Dials as it is made, and follows the note until `close`. It is the origin of every update it
// applies, so a listener on the document tells the note's from this device's.
export class NoteSocket {
  readonly doc: Y.Doc;
  readonly #heard: NoteSocketArgs["heard"];
  readonly #socket: LiveSocket;
  readonly #unwatch: () => void;
  #synced = false;

  constructor(args: NoteSocketArgs) {
    this.doc = args.doc;
    this.#heard = args.heard;
    this.#socket = createLiveSocket({
      address: async () => socketUrl(args.origin, notePath(args.itemId), await args.ticket()),
      backoff: { firstMs: 100, grow: 2, mostMs: REDIAL_MOST_MS },
      endsOn: [NOTE_SOCKET.missingCode],
      keepalive: {
        answerMs: PONG_WITHIN_MS,
        everyMs: PING_EVERY_MS,
        ping: noteWordFrame(NOTE_SOCKET.ping),
        pong: noteWordFrame(NOTE_SOCKET.pong),
      },
      onDown: (code) => {
        this.#synced = false;
        this.#heard(code === NOTE_SOCKET.missingCode ? GONE : DOWN);
      },
      onMessage: (frame) => {
        this.#read(frame);
      },
      onUp: () => {
        this.#synced = false;
        this.#socket.send(
          syncFrame((encoder) => {
            sync.writeSyncStep1(encoder, this.doc);
          }),
        );
        this.#heard(UP);
      },
      reach: args.reach,
      WebSocket: args.WebSocket,
    });
    const sent = this.doc.on("update", (update, origin) => {
      if (origin !== this) {
        this.#socket.send(
          syncFrame((encoder) => {
            sync.writeUpdate(encoder, update);
          }),
        );
      }
    });
    this.#unwatch = () => {
      this.doc.off("update", sent);
    };
    this.#socket.connect();
  }

  say(word: string): void {
    this.#socket.send(noteWordFrame(word));
  }

  // a page shown again: an open socket is pinged now
  probe(): void {
    this.#socket.probe();
  }

  close(): void {
    this.#unwatch();
    this.#socket.close();
  }

  #read(frame: Frame): void {
    if (frame.kind === "text") {
      if (frame.text.startsWith(WORD)) {
        this.#heard({ kind: "said", word: frame.text.slice(WORD.length) });
      }
      return;
    }
    const decoder = decoding.createDecoder(frame.bytes);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
      return;
    }
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    const kind = sync.readSyncMessage(decoder, reply, this.doc, this);
    if (encoding.length(reply) > 1) {
      this.#socket.send(encoding.toUint8Array(reply));
    }
    if (kind === sync.messageYjsSyncStep2 && !this.#synced) {
      this.#synced = true;
      this.#heard(SYNCED);
    }
  }
}
