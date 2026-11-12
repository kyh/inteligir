// A note's live document, opened by its item's id: y-partyserver's provider dials the note's object
// at the cloud origin the host names, on the account socket's ticket, and a document is shown only
// once it has synced, so a device never seeds a note. On top of the provider's own redial, a ping
// every 20 s finds a socket gone quiet, and a page shown again or a connection back probes at once;
// while the host says it is offline nothing dials and no ticket is asked. One step moves the
// connection from state to state, and the provider, the timers and the listeners follow the state it
// leaves (`follow`), so none outlives the state that wants it.

import YProvider from "y-partyserver/provider";
import * as Y from "yjs";

import { NOTE_SOCKET } from "@repo/contract/library/library-socket";

import { deferred } from "@repo/contract/deferred";
import type { NoteHost } from "@repo/editor/host-io";

// why a note takes no edit though its socket is up: it is past its size, or in Deleted
export type NoteHeld = "full" | "deleted";

// whether an edit made now reaches the note, and why not; a hold outranks the connection, since it
// stands whatever the socket does
export type NoteEdits =
  | { readonly kind: "live" }
  // the host is offline, or the socket has been down past its grace
  | { readonly kind: "offline" }
  | { readonly kind: "held"; readonly held: NoteHeld }
  // the note refused a frame too large for it, so the document is going back to the note's own
  | { readonly kind: "refused" };

export type NoteStatus =
  // stalled once the host is offline, or no socket opened within the grace, until the note opens
  | { readonly kind: "opening"; readonly stalled: boolean }
  // the library holds no such note: it was deleted for good, or never was
  | { readonly kind: "missing" }
  | {
      readonly kind: "open";
      // the document the editor binds, which a reopen replaces
      readonly doc: Y.Doc;
      readonly edits: NoteEdits;
      // an edit made here while no connection could carry it, which the next sync hands over
      readonly unsent: boolean;
    };

export interface NoteConnection {
  readonly status: () => NoteStatus;
  readonly subscribe: (listener: () => void) => () => void;
  // true once the note has stored every edit this device made before the call; false when the
  // connection closes, or the note drops or holds back the document, first
  readonly whenSaved: () => Promise<boolean>;
  // dials, and follows the note until `close`; a start after a close opens it afresh
  readonly start: () => void;
  readonly close: () => void;
}

export const PING_EVERY_MS = 20_000;
export const PONG_WITHIN_MS = 5000;
// a socket down this long turns the editor read-only, so a blip goes unseen and a drop does not
export const DOWN_GRACE_MS = 3000;
// the provider's own backoff ceiling, which a dial that could not get a ticket waits too
export const REDIAL_MS = 2500;

type Wire =
  // the host is offline: no provider, so nothing dials and no ticket is asked
  | { readonly kind: "paused" }
  // a provider dials, or waits out its backoff, with no socket open
  | {
      readonly kind: "dialing";
      // which provider: a redial over the same document makes the next
      readonly dial: number;
      readonly grace: "within" | "past";
      // its ticket could not be had, and the provider schedules nothing after a first dial's
      // failure, so a probe dials again after REDIAL_MS
      readonly ticketFailed: boolean;
    }
  | {
      readonly kind: "up";
      readonly dial: number;
      // the note's state crossed this socket, so a word from the note now is about this document
      readonly synced: boolean;
      // what the note said holds every edit back since this socket opened
      readonly greeted: NoteHeld | null;
      // the save asks sent on this socket, oldest first, each by the count of edits it covers
      readonly asked: readonly number[];
      // a ping waits on its pong
      readonly pinged: boolean;
    };

type Up = Extract<Wire, { kind: "up" }>;

interface Waiter {
  readonly upTo: number;
  readonly resolve: (saved: boolean) => void;
}

interface Opening {
  readonly kind: "opening";
  // the document the wire dials, shown once it syncs
  readonly doc: Y.Doc;
  readonly wire: Wire;
  readonly stalled: boolean;
}

interface Open {
  readonly kind: "open";
  readonly shown: Y.Doc;
  // the fresh document the wire dials in shown's place once the note refused a frame or grew full
  // under this socket, until the note's own copy syncs into it
  readonly reopen: Y.Doc | null;
  readonly wire: Wire;
  // what the note last said holds every edit back
  readonly held: NoteHeld | null;
  // this device's edits to shown, and how many of them the note confirmed stored
  readonly edits: number;
  readonly confirmed: number;
  readonly unsent: boolean;
  readonly waiters: readonly Waiter[];
}

type State = { readonly kind: "idle" } | { readonly kind: "missing" } | Opening | Open;

type NoteEvent =
  | { readonly kind: "start" | "host"; readonly offline: boolean }
  // `probe`: a page shown again, a connection back, the heartbeat, or a ticket's wait over
  | {
      readonly kind:
        | "close"
        | "gone"
        | "synced"
        | "probe"
        | "pong"
        | "pong-missed"
        | "grace-over"
        | "ticket-failed";
    }
  | { readonly kind: "socket"; readonly up: boolean }
  | { readonly kind: "said"; readonly word: string }
  | { readonly kind: "edited"; readonly doc: Y.Doc }
  | { readonly kind: "save-asked"; readonly resolve: (saved: boolean) => void };

type Effect =
  | {
      readonly kind: "settle";
      readonly resolves: readonly ((saved: boolean) => void)[];
      readonly saved: boolean;
    }
  // a ping on the open socket; the note asked whether it stored what this device sent
  | { readonly kind: "ping" | "ask" }
  // the provider dials now, unless a socket or a ticket is already on its way
  | { readonly kind: "connect" };

interface Step {
  readonly state: State;
  readonly effects: readonly Effect[];
}

interface WireStep {
  readonly wire: Wire;
  readonly effects: readonly Effect[];
}

const IDLE: State = { kind: "idle" };
const GONE: State = { kind: "missing" };
const PAUSED: Wire = { kind: "paused" };
const PING: Effect = { kind: "ping" };
const ASK: Effect = { kind: "ask" };
const CONNECT: Effect = { kind: "connect" };

const dialing = (dial: number): Wire => ({
  dial,
  grace: "within",
  kind: "dialing",
  ticketFailed: false,
});

const at = (state: State, effects: readonly Effect[] = []): Step => ({ effects, state });

const settle = (waiters: readonly Waiter[], saved: boolean): readonly Effect[] =>
  waiters.length === 0
    ? []
    : [{ kind: "settle", resolves: waiters.map(({ resolve }) => resolve), saved }];

const answer = (resolve: (saved: boolean) => void, saved: boolean): readonly Effect[] => [
  { kind: "settle", resolves: [resolve], saved },
];

const isHeld = (word: string): word is NoteHeld =>
  word === NOTE_SOCKET.full || word === NOTE_SOCKET.deleted;

// a page shown again or a connection back: a quiet socket is asked now, and a dropped one dialed
const probed = (wire: Wire): WireStep => {
  switch (wire.kind) {
    case "up": {
      return { effects: [PING], wire: { ...wire, pinged: true } };
    }
    case "dialing": {
      return { effects: [CONNECT], wire: { ...wire, ticketFailed: false } };
    }
    case "paused": {
      return { effects: [], wire };
    }
    // no default
  }
};

// a socket opened or closed: one that closes leaves the provider to redial it
const socketAfter = (wire: Wire, up: boolean): Wire => {
  if (up && wire.kind === "dialing") {
    return { asked: [], dial: wire.dial, greeted: null, kind: "up", pinged: false, synced: false };
  }
  return !up && wire.kind === "up" ? dialing(wire.dial) : wire;
};

// the wire's own moves, which an opening note and an open one share
const wireAfter = (wire: Wire, event: NoteEvent): WireStep => {
  const still: WireStep = { effects: [], wire };
  switch (event.kind) {
    case "host": {
      if (event.offline) {
        return { effects: [], wire: PAUSED };
      }
      return wire.kind === "paused" ? { effects: [], wire: dialing(0) } : probed(wire);
    }
    case "probe": {
      return probed(wire);
    }
    case "socket": {
      return { effects: [], wire: socketAfter(wire, event.up) };
    }
    case "pong": {
      return wire.kind === "up" ? { effects: [], wire: { ...wire, pinged: false } } : still;
    }
    // A socket gone quiet can take minutes to say it closed, so a fresh one dials beside it, over
    // the same document.
    case "pong-missed": {
      return wire.kind === "up" ? { effects: [], wire: dialing(wire.dial + 1) } : still;
    }
    case "grace-over": {
      return wire.kind === "dialing" ? { effects: [], wire: { ...wire, grace: "past" } } : still;
    }
    case "ticket-failed": {
      return wire.kind === "dialing"
        ? { effects: [], wire: { ...wire, ticketFailed: true } }
        : still;
    }
    default: {
      return still;
    }
  }
};

const openOn = (doc: Y.Doc, wire: Up): Open => ({
  confirmed: 0,
  edits: 0,
  held: wire.greeted,
  kind: "open",
  reopen: null,
  shown: doc,
  unsent: false,
  waiters: [],
  wire,
});

const openingAfter = (state: Opening, event: NoteEvent): Step => {
  const { wire } = state;
  switch (event.kind) {
    case "close": {
      return at(IDLE);
    }
    case "gone": {
      return at(GONE);
    }
    // nothing is shown, so no edit was made here
    case "save-asked": {
      return at(state, answer(event.resolve, true));
    }
    case "said": {
      if (wire.kind !== "up") {
        return at(state);
      }
      if (event.word === NOTE_SOCKET.refused) {
        return at({ ...state, doc: new Y.Doc(), wire: dialing(0) });
      }
      return isHeld(event.word)
        ? at({ ...state, wire: { ...wire, greeted: event.word } })
        : at(state);
    }
    case "synced": {
      return wire.kind === "up" ? at(openOn(state.doc, { ...wire, synced: true })) : at(state);
    }
    default: {
      const next = wireAfter(wire, event);
      const stalls =
        next.wire.kind === "paused" || (next.wire.kind === "dialing" && next.wire.grace === "past");
      return at({ ...state, stalled: state.stalled || stalls, wire: next.wire }, next.effects);
    }
  }
};

// asks the note whether it stored what this device edited, once the socket can carry the ask
const asking = (state: Open): Step => {
  const { wire } = state;
  if (state.waiters.length === 0 || wire.kind !== "up" || !wire.synced) {
    return at(state);
  }
  return at({ ...state, wire: { ...wire, asked: [...wire.asked, state.edits] } }, [ASK]);
};

// The note refused what this document holds, so it is dropped for the note's own: still shown,
// taking no edit, until a fresh one syncs.
const reopened = (state: Open): Open => ({
  ...state,
  reopen: new Y.Doc(),
  waiters: [],
  wire: dialing(0),
});

const saveAsked = (state: Open, resolve: (saved: boolean) => void): Step => {
  if (state.edits <= state.confirmed) {
    return at(state, answer(resolve, true));
  }
  // a note holding every edit back answers no ask, since what it was sent may have been dropped
  if (state.held !== null || state.reopen !== null) {
    return at(state, answer(resolve, false));
  }
  return asking({ ...state, waiters: [...state.waiters, { resolve, upTo: state.edits }] });
};

const synced = (state: Open, wire: Up): Step => {
  const up: Up = { ...wire, synced: true };
  if (state.reopen !== null) {
    return at(openOn(state.reopen, up), settle(state.waiters, false));
  }
  // a sync hands the note what this document holds that it lacks, the edits made while no socket
  // carried them among it
  return asking({ ...state, held: up.greeted, unsent: false, wire: up });
};

const said = (state: Open, wire: Up, word: string): Step => {
  if (word === NOTE_SOCKET.saved) {
    const [answered, ...asked] = wire.asked;
    // an answer to no ask confirms nothing
    if (answered === undefined) {
      return at(state);
    }
    const confirmed = Math.max(state.confirmed, answered);
    return at(
      {
        ...state,
        confirmed,
        waiters: state.waiters.filter(({ upTo }) => upTo > confirmed),
        wire: { ...wire, asked },
      },
      settle(
        state.waiters.filter(({ upTo }) => upTo <= confirmed),
        true,
      ),
    );
  }
  if (word === NOTE_SOCKET.refused) {
    return at(reopened(state), settle(state.waiters, false));
  }
  if (!isHeld(word)) {
    return at(state);
  }
  const held: Open = { ...state, held: word, waiters: [], wire: { ...wire, greeted: word } };
  // a full note greets every socket so; only one that synced may hold what it refused
  return at(
    word === NOTE_SOCKET.full && wire.synced ? reopened(held) : held,
    settle(state.waiters, false),
  );
};

const openAfter = (state: Open, event: NoteEvent): Step => {
  const { wire } = state;
  switch (event.kind) {
    case "close": {
      return at(IDLE, settle(state.waiters, false));
    }
    case "gone": {
      return at(GONE, settle(state.waiters, false));
    }
    case "save-asked": {
      return saveAsked(state, event.resolve);
    }
    // an edit to a document a reopen is dropping goes with it
    case "edited": {
      if (event.doc !== state.shown || state.reopen !== null) {
        return at(state);
      }
      const carried = wire.kind === "up" && wire.synced;
      return at({ ...state, edits: state.edits + 1, unsent: state.unsent || !carried });
    }
    case "synced": {
      return wire.kind === "up" ? synced(state, wire) : at(state);
    }
    case "said": {
      return wire.kind === "up" ? said(state, wire, event.word) : at(state);
    }
    default: {
      const next = wireAfter(wire, event);
      return at({ ...state, wire: next.wire }, next.effects);
    }
  }
};

const step = (state: State, event: NoteEvent): Step => {
  switch (state.kind) {
    case "idle":
    case "missing": {
      if (event.kind === "start") {
        const { offline } = event;
        const doc = new Y.Doc();
        return at({ doc, kind: "opening", stalled: offline, wire: offline ? PAUSED : dialing(0) });
      }
      return event.kind === "save-asked" ? at(state, answer(event.resolve, false)) : at(state);
    }
    case "opening": {
      return openingAfter(state, event);
    }
    case "open": {
      return openAfter(state, event);
    }
    // no default
  }
};

const LIVE: NoteEdits = { kind: "live" };
const OFFLINE: NoteEdits = { kind: "offline" };
const REFUSED: NoteEdits = { kind: "refused" };
const HELD: Record<NoteHeld, NoteEdits> = {
  deleted: { held: "deleted", kind: "held" },
  full: { held: "full", kind: "held" },
};
const FRESH: NoteStatus = { kind: "opening", stalled: false };
const STALLED: NoteStatus = { kind: "opening", stalled: true };
const MISSING: NoteStatus = { kind: "missing" };

const editsOf = (state: Open): NoteEdits => {
  if (state.held !== null) {
    return HELD[state.held];
  }
  if (state.reopen !== null) {
    return REFUSED;
  }
  const { wire } = state;
  return wire.kind === "paused" || (wire.kind === "dialing" && wire.grace === "past")
    ? OFFLINE
    : LIVE;
};

// a connection closed reads as one not yet started
const statusOf = (state: State): NoteStatus => {
  switch (state.kind) {
    case "idle": {
      return FRESH;
    }
    case "missing": {
      return MISSING;
    }
    case "opening": {
      return state.stalled ? STALLED : FRESH;
    }
    case "open": {
      return { doc: state.shown, edits: editsOf(state), kind: "open", unsent: state.unsent };
    }
    // no default
  }
};

// every status but an open one is a constant, and so is every NoteEdits
const sameStatus = (a: NoteStatus, b: NoteStatus): boolean =>
  a === b ||
  (a.kind === "open" &&
    b.kind === "open" &&
    a.doc === b.doc &&
    a.edits === b.edits &&
    a.unsent === b.unsent);

// what a running connection dials: the document, and the wire it dials it over
interface Running {
  readonly doc: Y.Doc;
  readonly wire: Wire;
}

const runningOf = (state: State): Running | null => {
  switch (state.kind) {
    case "opening": {
      return { doc: state.doc, wire: state.wire };
    }
    case "open": {
      return { doc: state.reopen ?? state.shown, wire: state.wire };
    }
    default: {
      return null;
    }
  }
};

// what the provider's status event carries
interface ProviderStatus {
  readonly status: "connecting" | "connected" | "disconnected";
}

// the provider dialing now, over the document it carries
interface Link {
  readonly dial: number;
  readonly doc: Y.Doc;
  readonly provider: YProvider;
  // a ticket is being asked for, so a probe asks no second one
  asking: boolean;
}

// a document whose edits reach the step, until `stop`
interface Watch {
  readonly doc: Y.Doc;
  readonly stop: () => void;
}

type Timer = "grace" | "redial" | "pong";

const TIMERS = {
  grace: { event: { kind: "grace-over" }, ms: DOWN_GRACE_MS },
  pong: { event: { kind: "pong-missed" }, ms: PONG_WITHIN_MS },
  redial: { event: { kind: "probe" }, ms: REDIAL_MS },
} as const satisfies Record<Timer, { readonly event: NoteEvent; readonly ms: number }>;

const PROBE: NoteEvent = { kind: "probe" };

class LiveNote implements NoteConnection {
  private readonly itemId: string;
  private readonly host: NoteHost;
  private readonly listeners = new Set<() => void>();
  // assigned only by `dispatch`
  private state: State = IDLE;
  private current: NoteStatus = FRESH;
  // what follows the state
  private link: Link | null = null;
  private watched: Watch | null = null;
  private unlisten: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly timers = new Map<Timer, ReturnType<typeof setTimeout>>();

  constructor(itemId: string, host: NoteHost) {
    this.itemId = itemId;
    this.host = host;
  }

  readonly status = (): NoteStatus => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly whenSaved = async (): Promise<boolean> => {
    const { promise, resolve } = deferred<boolean>();
    this.dispatch({ kind: "save-asked", resolve });
    return await promise;
  };

  readonly start = (): void => {
    this.dispatch({ kind: "start", offline: this.host.offline() });
  };

  readonly close = (): void => {
    this.dispatch({ kind: "close" });
  };

  private dispatch(event: NoteEvent): void {
    const next = step(this.state, event);
    this.state = next.state;
    this.follow();
    for (const effect of next.effects) {
      this.run(effect);
    }
    const status = statusOf(this.state);
    if (sameStatus(status, this.current)) {
      return;
    }
    this.current = status;
    for (const listener of this.listeners) {
      listener();
    }
  }

  // the provider, the timers and the listeners the state wants, and none it does not
  private follow(): void {
    const running = runningOf(this.state);
    const wire = running?.wire ?? PAUSED;
    this.listen(running !== null);
    this.watch(this.state.kind === "open" ? this.state.shown : null);
    this.dialTo(
      running === null || wire.kind === "paused" ? null : { dial: wire.dial, doc: running.doc },
    );
    this.arm("grace", wire.kind === "dialing" && wire.grace === "within");
    this.arm("redial", wire.kind === "dialing" && wire.ticketFailed);
    this.arm("pong", wire.kind === "up" && wire.pinged);
    this.beat(wire.kind === "up");
  }

  private run(effect: Effect): void {
    switch (effect.kind) {
      case "settle": {
        for (const resolve of effect.resolves) {
          resolve(effect.saved);
        }
        break;
      }
      case "ping": {
        const socket = this.link?.provider.ws ?? null;
        if (socket !== null && socket.readyState === socket.OPEN) {
          socket.send(NOTE_SOCKET.ping);
        }
        break;
      }
      case "ask": {
        this.link?.provider.sendMessage(NOTE_SOCKET.savedAsk);
        break;
      }
      case "connect": {
        if (this.link !== null) {
          void this.connect(this.link);
        }
        break;
      }
      // no default
    }
  }

  private listen(on: boolean): void {
    if (on && this.unlisten === null) {
      const probe = (): void => {
        this.dispatch(PROBE);
      };
      const onVisibility = (): void => {
        if (document.visibilityState === "visible") {
          probe();
        }
      };
      const stopOffline = this.host.onOfflineChange(() => {
        this.dispatch({ kind: "host", offline: this.host.offline() });
      });
      window.addEventListener("online", probe);
      window.addEventListener("pageshow", probe);
      document.addEventListener("visibilitychange", onVisibility);
      this.unlisten = () => {
        stopOffline();
        window.removeEventListener("online", probe);
        window.removeEventListener("pageshow", probe);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    } else if (!on && this.unlisten !== null) {
      this.unlisten();
      this.unlisten = null;
    }
  }

  private watch(doc: Y.Doc | null): void {
    if ((this.watched?.doc ?? null) === doc) {
      return;
    }
    this.watched?.stop();
    this.watched = doc === null ? null : this.watching(doc);
  }

  // this device's edits to `doc`: every update but the provider's, which carries the note's own
  private watching(doc: Y.Doc): Watch {
    const onUpdate = doc.on("update", (_update, origin) => {
      if (origin !== this.link?.provider) {
        this.dispatch({ doc, kind: "edited" });
      }
    });
    return {
      doc,
      stop: () => {
        doc.off("update", onUpdate);
      },
    };
  }

  private dialTo(target: Pick<Link, "dial" | "doc"> | null): void {
    const { link } = this;
    if (
      link !== null &&
      (target === null || link.dial !== target.dial || link.doc !== target.doc)
    ) {
      this.link = null;
      link.provider.destroy();
    }
    if (target !== null && this.link === null) {
      const next = this.provide(target.dial, target.doc);
      this.link = next;
      void this.connect(next);
    }
  }

  // a provider over `doc`, whose every word reaches the step while it is the one dialing
  private provide(dial: number, doc: Y.Doc): Link {
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
    const link: Link = { asking: false, dial, doc, provider };
    const heard = (event: NoteEvent): void => {
      if (this.link === link) {
        this.dispatch(event);
      }
    };
    provider.on("status", ({ status }: ProviderStatus) => {
      if (status !== "connecting") {
        heard({ kind: "socket", up: status === "connected" });
        return;
      }
      // a raw frame the provider passes over: the object's answer to a ping
      const socket = provider.ws;
      socket?.addEventListener("message", (event) => {
        if (event.data === NOTE_SOCKET.pong && provider.ws === socket) {
          heard({ kind: "pong" });
        }
      });
    });
    provider.on("synced", (isSynced: boolean) => {
      if (isSynced) {
        heard({ kind: "synced" });
      }
    });
    provider.on("custom-message", (word: string) => {
      heard({ kind: "said", word });
    });
    provider.on("connection-close", (event: CloseEvent) => {
      if (event.code === NOTE_SOCKET.missingCode) {
        heard({ kind: "gone" });
      }
    });
    return link;
  }

  private async connect(link: Link): Promise<void> {
    if (link.asking || link.provider.ws !== null) {
      return;
    }
    link.asking = true;
    let dialed = true;
    try {
      await link.provider.connect();
    } catch {
      dialed = false;
    }
    link.asking = false;
    // a hang-up while the ticket was asked for: the provider opened its socket after its destroy
    if (this.link !== link) {
      link.provider.destroy();
    } else if (!dialed) {
      this.dispatch({ kind: "ticket-failed" });
    }
  }

  private arm(timer: Timer, on: boolean): void {
    const armed = this.timers.get(timer);
    if (on && armed === undefined) {
      const { event, ms } = TIMERS[timer];
      this.timers.set(
        timer,
        setTimeout(() => {
          this.timers.delete(timer);
          this.dispatch(event);
        }, ms),
      );
    } else if (!on && armed !== undefined) {
      clearTimeout(armed);
      this.timers.delete(timer);
    }
  }

  private beat(on: boolean): void {
    if (on && this.heartbeat === undefined) {
      this.heartbeat = setInterval(() => {
        this.dispatch(PROBE);
      }, PING_EVERY_MS);
    } else if (!on && this.heartbeat !== undefined) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }
}

// inert until `start`, so a connection a discarded render makes leaves nothing running
export const noteConnection = (itemId: string, host: NoteHost): NoteConnection =>
  new LiveNote(itemId, host);
