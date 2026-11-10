// A note's live document, opened by its item's id: y-partyserver's provider dials the note's object
// on the account socket's ticket, and the editor binds to the document only once it has synced, so
// a device never seeds a note. On top of the provider's own redial, a ping every 20 s finds a
// socket gone quiet, and a page shown again or a connection back probes at once. The status is one
// value: whether the note is there, whether an edit reaches it now, and whether the note holds
// every edit back, which the note's object says itself.

import YProvider from "y-partyserver/provider";
import * as Y from "yjs";

import { deferred } from "@repo/editor/deferred";
import type { NoteHost } from "@repo/editor/host-io";

// why a note takes no edit though its socket is up: it is past its size, or in Deleted
export type NoteHeld = "full" | "deleted";

export type NoteStatus =
  | { readonly kind: "opening" }
  // the library holds no such note: it was deleted for good, or never was
  | { readonly kind: "missing" }
  | {
      readonly kind: "open";
      // the document the editor binds, which a reopen replaces
      readonly doc: Y.Doc;
      // an edit made now reaches the note: the host is online and the socket is up, or was a
      // moment ago
      readonly live: boolean;
      readonly held: NoteHeld | null;
    };

export interface NoteConnection {
  readonly status: () => NoteStatus;
  readonly subscribe: (listener: () => void) => () => void;
  // true once the note has stored every edit this device made before the call; false when the
  // connection closes, or drops the document, first
  readonly whenSaved: () => Promise<boolean>;
  readonly close: () => void;
}

// The note's object answers a ping without waking (its auto-response), so a socket gone quiet is
// found at no cost to it; its other words are y-partyserver's custom messages.
/** @internal */
export const NOTE_SOCKET = {
  deleted: "deleted",
  full: "full",
  // the close code of a note that is not there, which the provider would otherwise redial forever
  missingCode: 4404,
  ping: "ping",
  pong: "pong",
  // a frame past a cap was refused, so this socket takes nothing more
  refused: "read-only",
  saved: "saved",
  savedAsk: "saved?",
} as const;

/** @internal */
export const PING_EVERY_MS = 20_000;
/** @internal */
export const PONG_WITHIN_MS = 5000;
// a socket down this long turns the editor read-only, so a blip goes unseen and a drop does not
/** @internal */
export const DOWN_GRACE_MS = 3000;
// the provider's own backoff ceiling, which a dial that could not get a ticket waits too
/** @internal */
export const REDIAL_MS = 2500;

// what the provider's events carry (y-partyserver's WebsocketProvider)
interface ProviderStatus {
  readonly status: "connecting" | "connected" | "disconnected";
}

// one document and the socket that dials it: a reopen makes another beside the one still shown
interface Link {
  readonly doc: Y.Doc;
  readonly provider: YProvider;
  synced: boolean;
  // what this socket's note said holds it, since the socket opened
  held: NoteHeld | null;
  // the edits asked about on this socket, oldest first, each by the count it covers
  readonly asked: number[];
}

interface Waiter {
  readonly upTo: number;
  readonly resolve: (saved: boolean) => void;
}

class LiveNote implements NoteConnection {
  private readonly listeners = new Set<() => void>();
  private current: NoteStatus = { kind: "opening" };
  private closed = false;
  // the document the editor shows, and the one dialed, which differ while a reopen syncs
  private shown: Link | null = null;
  private link: Link;
  private connected = false;
  private pastGrace = false;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private redialTimer: ReturnType<typeof setTimeout> | undefined;
  // this device's edits to the shown document, and how many of them the note confirmed stored
  private edits = 0;
  private confirmed = 0;
  private waiters: Waiter[] = [];
  private readonly stopOffline: () => void;
  private readonly itemId: string;
  private readonly host: NoteHost;

  constructor(itemId: string, host: NoteHost) {
    this.itemId = itemId;
    this.host = host;
    this.stopOffline = host.onOfflineChange(() => {
      if (!host.offline()) {
        this.probe();
      }
      this.refresh();
    });
    window.addEventListener("online", this.probe);
    window.addEventListener("pageshow", this.probe);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.link = this.open();
    void this.dial(this.link);
  }

  readonly status = (): NoteStatus => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly whenSaved = async (): Promise<boolean> => {
    if (this.closed || this.current.kind === "missing") {
      return false;
    }
    if (this.edits <= this.confirmed) {
      return true;
    }
    const { promise, resolve } = deferred<boolean>();
    this.waiters.push({ resolve, upTo: this.edits });
    this.ask(this.link);
    return await promise;
  };

  readonly close = (): void => {
    if (this.closed) {
      return;
    }
    this.teardown();
    this.closed = true;
    this.listeners.clear();
  };

  private open(): Link {
    const doc = new Y.Doc();
    const provider = new YProvider(location.host, this.itemId, doc, {
      WebSocketPolyfill: WebSocket,
      connect: false,
      disableBc: true,
      params: async () => ({ ticket: await this.host.socketTicket() }),
      prefix: this.host.notePath(this.itemId),
      protocol: location.protocol === "https:" ? "wss" : "ws",
    });
    // presence is off: the default awareness stays, holding nothing of this device
    provider.awareness.setLocalState(null);
    const link: Link = { asked: [], doc, held: null, provider, synced: false };
    doc.on("update", (_update, origin) => {
      if (origin !== provider && link === this.shown) {
        this.edits += 1;
      }
    });
    provider.on("status", ({ status }: ProviderStatus) => {
      if (link === this.link) {
        this.onSocket(link, status);
      }
    });
    provider.on("synced", (synced: boolean) => {
      if (synced && link === this.link) {
        this.onSynced(link);
      }
    });
    provider.on("custom-message", (message: string) => {
      if (link === this.link) {
        this.onMessage(link, message);
      }
    });
    provider.on("connection-close", (event: CloseEvent) => {
      if (link === this.link && event.code === NOTE_SOCKET.missingCode) {
        this.gone();
      }
    });
    return link;
  }

  private onSocket(link: Link, status: ProviderStatus["status"]): void {
    switch (status) {
      case "connecting": {
        link.held = null;
        link.asked.length = 0;
        // a raw frame the provider passes over: the object's answer to a ping
        link.provider.ws?.addEventListener("message", (event) => {
          if (event.data === NOTE_SOCKET.pong) {
            clearTimeout(this.pongTimer);
            this.pongTimer = undefined;
          }
        });
        break;
      }
      case "connected": {
        this.connected = true;
        clearTimeout(this.graceTimer);
        this.graceTimer = undefined;
        this.pastGrace = false;
        this.pingTimer = setInterval(() => {
          this.ping(link);
        }, PING_EVERY_MS);
        this.refresh();
        break;
      }
      case "disconnected": {
        link.asked.length = 0;
        this.goneDown();
        break;
      }
      // no default
    }
  }

  private onSynced(link: Link): void {
    link.synced = true;
    if (this.shown !== link) {
      // the document a reopen replaces goes with what the note refused in it
      this.shown?.provider.destroy();
      this.shown = link;
      this.edits = 0;
      this.confirmed = 0;
    }
    this.refresh();
    this.ask(link);
  }

  private onMessage(link: Link, message: string): void {
    switch (message) {
      case NOTE_SOCKET.saved: {
        this.confirmed = Math.max(this.confirmed, link.asked.shift() ?? 0);
        this.settle(null);
        break;
      }
      case NOTE_SOCKET.deleted: {
        link.held = "deleted";
        this.refresh();
        break;
      }
      case NOTE_SOCKET.full: {
        link.held = "full";
        this.reopen();
        break;
      }
      case NOTE_SOCKET.refused: {
        this.reopen();
        break;
      }
      default:
    }
  }

  // The note refused what this document holds, so it is dropped for the note's own: shown as it
  // was, taking no edit, until the new one syncs.
  private reopen(): void {
    const dropped = this.link;
    dropped.provider.disconnect();
    this.settle(false);
    this.connected = false;
    this.stopHeartbeat();
    this.link = this.open();
    this.link.held = dropped.held;
    this.refresh();
    void this.dial(this.link);
  }

  private gone(): void {
    this.teardown();
    this.shown = null;
    this.setStatus({ kind: "missing" });
  }

  private teardown(): void {
    clearTimeout(this.graceTimer);
    clearTimeout(this.redialTimer);
    this.stopHeartbeat();
    window.removeEventListener("online", this.probe);
    window.removeEventListener("pageshow", this.probe);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stopOffline();
    this.link.provider.destroy();
    this.shown?.provider.destroy();
    this.settle(false);
  }

  private async dial(link: Link): Promise<void> {
    clearTimeout(this.redialTimer);
    this.redialTimer = undefined;
    try {
      await link.provider.connect();
    } catch {
      // no ticket to dial with, and the provider schedules nothing after a first dial's failure
      if (!this.closed && link === this.link && this.current.kind !== "missing") {
        this.redialTimer = setTimeout(() => {
          void this.dial(link);
        }, REDIAL_MS);
      }
    }
  }

  // a page shown again or a connection back: a quiet socket is asked now, and a dropped one dialed
  private readonly probe = (): void => {
    if (this.closed || this.current.kind === "missing") {
      return;
    }
    if (this.connected) {
      this.ping(this.link);
    } else if (this.link.provider.ws === null) {
      void this.dial(this.link);
    }
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      this.probe();
    }
  };

  private ping(link: Link): void {
    const socket = link.provider.ws;
    if (socket === null || socket.readyState !== socket.OPEN) {
      return;
    }
    socket.send(NOTE_SOCKET.ping);
    this.pongTimer ??= setTimeout(() => {
      this.pongTimer = undefined;
      socket.close();
      this.goneDown();
    }, PONG_WITHIN_MS);
  }

  private stopHeartbeat(): void {
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    this.pingTimer = undefined;
    this.pongTimer = undefined;
  }

  private goneDown(): void {
    this.connected = false;
    this.stopHeartbeat();
    if (this.graceTimer === undefined && !this.pastGrace) {
      this.graceTimer = setTimeout(() => {
        this.graceTimer = undefined;
        this.pastGrace = true;
        this.refresh();
      }, DOWN_GRACE_MS);
    }
    this.refresh();
  }

  // asks the note whether it stored what this device edited, once the socket can carry the ask
  private ask(link: Link): void {
    if (this.waiters.length === 0 || link !== this.shown || !this.connected || !link.synced) {
      return;
    }
    link.asked.push(this.edits);
    link.provider.sendMessage(NOTE_SOCKET.savedAsk);
  }

  // `null`: settles each waiter the note's answers cover; a boolean settles every waiter so
  private settle(saved: boolean | null): void {
    const done = this.waiters.filter(({ upTo }) => saved !== null || upTo <= this.confirmed);
    this.waiters = this.waiters.filter((waiter) => !done.includes(waiter));
    for (const { resolve } of done) {
      resolve(saved ?? true);
    }
  }

  private refresh(): void {
    const { shown } = this;
    if (this.closed || shown === null || this.current.kind === "missing") {
      return;
    }
    const live =
      shown === this.link &&
      shown.synced &&
      !this.host.offline() &&
      (this.connected || !this.pastGrace);
    this.setStatus({ doc: shown.doc, held: shown.held, kind: "open", live });
  }

  private setStatus(next: NoteStatus): void {
    const was = this.current;
    const same =
      next.kind === "open"
        ? was.kind === "open" &&
          next.doc === was.doc &&
          next.live === was.live &&
          next.held === was.held
        : next.kind === was.kind;
    if (same) {
      return;
    }
    this.current = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const openNote = (itemId: string, host: NoteHost): NoteConnection =>
  new LiveNote(itemId, host);
