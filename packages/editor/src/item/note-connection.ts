// A note's live document, opened by its item's id: y-partyserver's provider dials the note's object
// at the cloud origin the host names, on the account socket's ticket, and a document is shown only
// once it has synced, so a device never seeds a note. On top of the provider's own redial, a ping
// every 20 s finds a socket gone quiet, and a page shown again or a connection back probes at once.
// The status is one value: whether the note is there, whether an edit reaches it now, and whether
// the note holds every edit back, which the note's object says itself.

import YProvider from "y-partyserver/provider";
import * as Y from "yjs";

import { NOTE_SOCKET } from "@repo/contract/library/library-socket";

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
  // an edit made here while no connection could carry it, which the note may not hold until the
  // socket syncs again; `subscribe` hears it turn
  readonly unsent: () => boolean;
  // dials, and follows the note until `close`; a start after a close opens it afresh
  readonly start: () => void;
  readonly close: () => void;
}

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

// what the provider's status event carries
interface ProviderStatus {
  readonly status: "connecting" | "connected" | "disconnected";
}

// one provider and the document it dials: a redial makes another over the same document, a reopen
// another over a fresh one
interface Link {
  readonly doc: Y.Doc;
  readonly provider: YProvider;
  // replaced, so nothing it says or does reaches the note's state
  dead: boolean;
  // what the note said holds it since this socket opened, which stands once it has synced
  greeted: NoteHeld | null;
  // this socket has synced, so a word from the note now is about what this document holds
  synced: boolean;
  // the edits asked about on this socket, oldest first, each by the count it covers
  readonly asked: number[];
}

interface Waiter {
  readonly upTo: number;
  readonly resolve: (saved: boolean) => void;
}

class LiveNote implements NoteConnection {
  private readonly itemId: string;
  private readonly host: NoteHost;
  private readonly listeners = new Set<() => void>();
  private current: NoteStatus = { kind: "opening" };
  private running = false;
  private link: Link | null = null;
  // the document the editor shows: the first to sync, until a reopen's syncs in its place
  private shown: Y.Doc | null = null;
  private held: NoteHeld | null = null;
  private socketUp = false;
  private pastGrace = false;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private redialTimer: ReturnType<typeof setTimeout> | undefined;
  // this device's edits to the shown document, and how many of them the note confirmed stored
  private edits = 0;
  private confirmed = 0;
  private editedUnsent = false;
  private waiters: Waiter[] = [];
  private stopOffline: (() => void) | null = null;

  constructor(itemId: string, host: NoteHost) {
    this.itemId = itemId;
    this.host = host;
  }

  readonly status = (): NoteStatus => this.current;

  readonly unsent = (): boolean => this.editedUnsent;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly whenSaved = async (): Promise<boolean> => {
    if (!this.running || this.link === null) {
      return false;
    }
    if (this.edits <= this.confirmed) {
      return true;
    }
    // a note holding every edit back answers no ask, since what it was sent may have been dropped
    if (this.held !== null) {
      return false;
    }
    const { promise, resolve } = deferred<boolean>();
    this.waiters.push({ resolve, upTo: this.edits });
    this.ask(this.link);
    return await promise;
  };

  readonly start = (): void => {
    if (this.running) {
      return;
    }
    this.running = true;
    this.shown = null;
    this.held = null;
    this.edits = 0;
    this.confirmed = 0;
    this.editedUnsent = false;
    this.setStatus({ kind: "opening" });
    this.stopOffline = this.host.onOfflineChange(() => {
      if (!this.host.offline()) {
        this.probe();
      }
      this.refresh();
    });
    window.addEventListener("online", this.probe);
    window.addEventListener("pageshow", this.probe);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.replaceLink(new Y.Doc());
  };

  readonly close = (): void => {
    if (!this.running) {
      return;
    }
    this.running = false;
    clearTimeout(this.graceTimer);
    clearTimeout(this.redialTimer);
    this.graceTimer = undefined;
    this.redialTimer = undefined;
    this.stopHeartbeat();
    window.removeEventListener("online", this.probe);
    window.removeEventListener("pageshow", this.probe);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stopOffline?.();
    this.stopOffline = null;
    this.drop();
    this.socketUp = false;
    this.pastGrace = false;
    this.settle(false);
  };

  private drop(): void {
    if (this.link !== null) {
      this.link.dead = true;
      this.link.provider.destroy();
      this.link = null;
    }
  }

  // a provider over `doc` in place of the one dialing now, dialed at once
  private replaceLink(doc: Y.Doc): void {
    this.drop();
    this.socketUp = false;
    this.stopHeartbeat();
    const cloud = new URL(this.host.socketOrigin);
    const provider = new YProvider(cloud.host, this.itemId, doc, {
      // read at each dial rather than when the module loaded, as the provider's default is
      WebSocketPolyfill: WebSocket,
      connect: false,
      disableBc: true,
      params: async () => ({ ticket: await this.host.socketTicket() }),
      prefix: this.host.notePath(this.itemId),
      protocol: cloud.protocol === "https:" ? "wss" : "ws",
    });
    // presence is off: the default awareness stays, holding nothing of this device
    provider.awareness.setLocalState(null);
    const link: Link = { asked: [], dead: false, doc, greeted: null, provider, synced: false };
    this.link = link;
    doc.on("update", (_update, origin) => {
      if (origin !== provider && !link.dead && doc === this.shown) {
        this.edits += 1;
        if (!this.socketUp || !link.synced || this.host.offline()) {
          this.markUnsent(true);
        }
      }
    });
    provider.on("status", ({ status }: ProviderStatus) => {
      if (!link.dead) {
        this.onSocket(link, status);
      }
    });
    provider.on("synced", (synced: boolean) => {
      if (synced && !link.dead) {
        this.onSynced(link);
      }
    });
    provider.on("custom-message", (message: string) => {
      if (!link.dead) {
        this.onMessage(link, message);
      }
    });
    provider.on("connection-close", (event: CloseEvent) => {
      if (!link.dead && event.code === NOTE_SOCKET.missingCode) {
        this.gone();
      }
    });
    void this.dial(link);
  }

  private async dial(link: Link): Promise<void> {
    clearTimeout(this.redialTimer);
    this.redialTimer = undefined;
    try {
      await link.provider.connect();
    } catch {
      // no ticket to dial with, and the provider schedules nothing after a first dial's failure
      if (!link.dead) {
        this.redialTimer = setTimeout(() => {
          void this.dial(link);
        }, REDIAL_MS);
      }
    }
    // a close while the ticket was asked for: the provider opened its socket after its destroy
    if (link.dead) {
      link.provider.destroy();
    }
  }

  private onSocket(link: Link, status: ProviderStatus["status"]): void {
    switch (status) {
      case "connecting": {
        link.greeted = null;
        link.synced = false;
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
        this.socketUp = true;
        clearTimeout(this.graceTimer);
        this.graceTimer = undefined;
        this.pastGrace = false;
        this.pingTimer = setInterval(this.ping, PING_EVERY_MS);
        this.refresh();
        break;
      }
      case "disconnected": {
        link.asked.length = 0;
        this.socketDown();
        break;
      }
      // no default
    }
  }

  // A sync hands the note what this document holds that it lacks, the edits made while no socket
  // carried them among it.
  private onSynced(link: Link): void {
    link.synced = true;
    this.held = link.greeted;
    if (this.shown !== link.doc) {
      this.shown = link.doc;
      this.edits = 0;
      this.confirmed = 0;
    }
    this.markUnsent(false);
    this.refresh();
    this.ask(link);
  }

  private markUnsent(unsent: boolean): void {
    if (this.editedUnsent === unsent) {
      return;
    }
    this.editedUnsent = unsent;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private onMessage(link: Link, message: string): void {
    switch (message) {
      case NOTE_SOCKET.saved: {
        this.confirmed = Math.max(this.confirmed, link.asked.shift() ?? 0);
        this.settle(null);
        break;
      }
      case NOTE_SOCKET.deleted:
      case NOTE_SOCKET.full: {
        link.greeted = message;
        this.held = message;
        this.settle(false);
        // a full note greets every socket so; only one that synced may hold what it refused
        if (message === NOTE_SOCKET.full && link.synced) {
          this.reopen();
        } else {
          this.refresh();
        }
        break;
      }
      case NOTE_SOCKET.refused: {
        this.reopen();
        break;
      }
      default:
    }
  }

  // The note refused what this document holds, so it is dropped for the note's own: still shown,
  // taking no edit, until the new one syncs.
  private reopen(): void {
    this.settle(false);
    this.replaceLink(new Y.Doc());
    this.refresh();
  }

  // A socket gone quiet can take minutes to say it closed, so a fresh one dials beside it, over
  // the same document.
  private readonly redial = (): void => {
    const { link } = this;
    if (link === null) {
      return;
    }
    this.replaceLink(link.doc);
    this.socketDown();
  };

  private gone(): void {
    this.close();
    this.setStatus({ kind: "missing" });
  }

  // a page shown again or a connection back: a quiet socket is asked now, and a dropped one dialed
  private readonly probe = (): void => {
    const { link } = this;
    if (link === null) {
      return;
    }
    if (this.socketUp) {
      this.ping();
    } else if (link.provider.ws === null) {
      void this.dial(link);
    }
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      this.probe();
    }
  };

  private readonly ping = (): void => {
    const socket = this.link?.provider.ws ?? null;
    if (socket === null || socket.readyState !== socket.OPEN) {
      return;
    }
    socket.send(NOTE_SOCKET.ping);
    this.pongTimer ??= setTimeout(() => {
      this.pongTimer = undefined;
      this.redial();
    }, PONG_WITHIN_MS);
  };

  private stopHeartbeat(): void {
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    this.pingTimer = undefined;
    this.pongTimer = undefined;
  }

  private socketDown(): void {
    this.socketUp = false;
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
    if (this.waiters.length === 0 || link.doc !== this.shown || !this.socketUp) {
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
    const { link, shown } = this;
    if (!this.running || shown === null) {
      return;
    }
    const live = link?.doc === shown && !this.host.offline() && (this.socketUp || !this.pastGrace);
    this.setStatus({ doc: shown, held: this.held, kind: "open", live });
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

// inert until `start`, so a connection a discarded render makes leaves nothing running
export const noteConnection = (itemId: string, host: NoteHost): NoteConnection =>
  new LiveNote(itemId, host);
