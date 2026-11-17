// A note's live document, opened by its item's id: its socket (`./note-socket`) dials the note's
// object at the cloud origin the host names, on a ticket the host asks for, and a document is shown
// only once it has synced, so a device never seeds a note. While the host cannot reach the cloud
// nothing dials and no ticket is asked, and a page shown again pings at once. One step moves the
// connection from state to state, and the socket, the grace and the listeners follow the state it
// leaves (`follow`), so none outlives the state that wants it.

import * as Y from "yjs";

import { NOTE_SOCKET } from "@repo/contract/library/note-socket";

import { deferred } from "@repo/contract/deferred";
import type { NoteHost } from "@repo/editor/host-io";

import { NoteSocket } from "./note-socket";
import type { NoteSocketEvent } from "./note-socket";

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
      // an edit made here that `holds`, asked now, would wait on or say the note lacks
      readonly unsaved: boolean;
      // an edit made here while no connection could carry it, which the next sync hands over
      readonly unsent: boolean;
    };

export interface NoteConnection {
  readonly status: () => NoteStatus;
  readonly subscribe: (listener: () => void) => () => void;
  // whether the note holds every edit this device made before the call, which a leave asks; it
  // answers at once unless only a live note's word can say (`holdsAt`)
  readonly holds: () => Promise<boolean>;
  // dials, and follows the note until `close`; a start after a close opens it afresh
  readonly start: () => void;
  readonly close: () => void;
}

// a socket down this long turns the editor read-only, so a blip goes unseen and a drop does not
export const DOWN_GRACE_MS = 3000;

type Wire =
  // the host is offline: its socket dials nothing and asks no ticket
  | { readonly kind: "paused" }
  // the socket dials, or waits out its backoff, with none open
  | { readonly kind: "dialing"; readonly grace: "within" | "past" }
  | {
      readonly kind: "up";
      // the note's state crossed this socket, so a word from the note now is about this document
      readonly synced: boolean;
      // what the note said holds every edit back since this socket opened
      readonly greeted: NoteHeld | null;
      // the save asks sent on this socket, oldest first, each by the count of edits it covers
      readonly asked: readonly number[];
    };

type Up = Extract<Wire, { kind: "up" }>;

// a leave waiting on the note's word that it stored this many of the device's edits
interface Waiter {
  readonly upTo: number;
  readonly resolve: (holds: boolean) => void;
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
  | NoteSocketEvent
  | { readonly kind: "start" | "host"; readonly offline: boolean }
  | { readonly kind: "close" | "grace-over" }
  | { readonly kind: "edited"; readonly doc: Y.Doc }
  | { readonly kind: "holds-asked"; readonly resolve: (holds: boolean) => void };

type Effect =
  // a leave is told whether the note holds its edits
  | { readonly kind: "tell"; readonly resolve: (holds: boolean) => void; readonly holds: boolean }
  // the note asked whether it stored what this device sent
  | { readonly kind: "ask" };

interface Step {
  readonly state: State;
  readonly effects: readonly Effect[];
}

const IDLE: State = { kind: "idle" };
const GONE: State = { kind: "missing" };
const PAUSED: Wire = { kind: "paused" };
const DIALING: Wire = { grace: "within", kind: "dialing" };
const ASK: Effect = { kind: "ask" };

const at = (state: State, effects: readonly Effect[] = []): Step => ({ effects, state });

const isHeld = (word: string): word is NoteHeld =>
  word === NOTE_SOCKET.full || word === NOTE_SOCKET.deleted;

// the wire's own moves, which an opening note and an open one share
const wireAfter = (wire: Wire, event: NoteEvent): Wire => {
  switch (event.kind) {
    case "host": {
      if (event.offline) {
        return PAUSED;
      }
      return wire.kind === "paused" ? DIALING : wire;
    }
    case "up": {
      return wire.kind === "dialing"
        ? { asked: [], greeted: null, kind: "up", synced: false }
        : wire;
    }
    case "down": {
      return wire.kind === "up" ? DIALING : wire;
    }
    case "grace-over": {
      return wire.kind === "dialing" ? { ...wire, grace: "past" } : wire;
    }
    default: {
      return wire;
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
    case "said": {
      if (wire.kind !== "up") {
        return at(state);
      }
      if (event.word === NOTE_SOCKET.refused) {
        return at({ ...state, doc: new Y.Doc(), wire: DIALING });
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
      const stalls = next.kind === "paused" || (next.kind === "dialing" && next.grace === "past");
      return at({ ...state, stalled: state.stalled || stalls, wire: next });
    }
  }
};

const LIVE: NoteEdits = { kind: "live" };
const OFFLINE: NoteEdits = { kind: "offline" };
const REFUSED: NoteEdits = { kind: "refused" };
const HELD: Record<NoteHeld, NoteEdits> = {
  deleted: { held: "deleted", kind: "held" },
  full: { held: "full", kind: "held" },
};

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

// Whether the note holds the first `upTo` edits made here, by where it stands: one that is not
// open, or takes no edit, holds all it can; one with no connection all but what was typed then; a
// live one those it said it stored, and null while only its word can say.
const holdsAt = (state: State, upTo: number): boolean | null => {
  if (state.kind !== "open") {
    return true;
  }
  switch (editsOf(state).kind) {
    case "held":
    case "refused": {
      return true;
    }
    case "offline": {
      return !state.unsent;
    }
    case "live": {
      return upTo <= state.confirmed ? true : null;
    }
    // no default
  }
};

const telling = (state: State, { resolve, upTo }: Waiter): readonly Effect[] => {
  const holds = holdsAt(state, upTo);
  return holds === null ? [] : [{ holds, kind: "tell", resolve }];
};

// asks the note whether it stored what a leave waits on, once the socket can carry the ask
const asking = (state: Open): Step => {
  const { wire } = state;
  const waits = state.waiters.some(({ upTo }) => holdsAt(state, upTo) === null);
  if (!waits || wire.kind !== "up" || !wire.synced) {
    return at(state);
  }
  return at({ ...state, wire: { ...wire, asked: [...wire.asked, state.edits] } }, [ASK]);
};

// The note refused what this document holds, so it is dropped for the note's own: still shown,
// taking no edit, until a fresh one syncs.
const reopened = (state: Open): Open => ({ ...state, reopen: new Y.Doc(), wire: DIALING });

const synced = (state: Open, wire: Up): Step => {
  const up: Up = { ...wire, synced: true };
  if (state.reopen !== null) {
    return at(openOn(state.reopen, up));
  }
  // a sync hands the note what this document holds that it lacks, the edits made while no socket
  // carried them among it
  return asking({ ...state, held: up.greeted, unsent: false, wire: up });
};

const said = (state: Open, wire: Up, word: string): Open => {
  if (word === NOTE_SOCKET.saved) {
    const [answered, ...asked] = wire.asked;
    // an answer to no ask confirms nothing
    return answered === undefined
      ? state
      : { ...state, confirmed: Math.max(state.confirmed, answered), wire: { ...wire, asked } };
  }
  if (word === NOTE_SOCKET.refused) {
    return reopened(state);
  }
  if (!isHeld(word)) {
    return state;
  }
  const held: Open = { ...state, held: word, wire: { ...wire, greeted: word } };
  // a full note greets every socket so; only one that synced may hold what it refused
  return word === NOTE_SOCKET.full && wire.synced ? reopened(held) : held;
};

const openAfter = (state: Open, event: NoteEvent): Step => {
  const { wire } = state;
  switch (event.kind) {
    case "close": {
      return at(IDLE);
    }
    case "gone": {
      return at(GONE);
    }
    case "holds-asked": {
      const waiter: Waiter = { resolve: event.resolve, upTo: state.edits };
      return asking({ ...state, waiters: [...state.waiters, waiter] });
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
      return at(wire.kind === "up" ? said(state, wire, event.word) : state);
    }
    default: {
      return at({ ...state, wire: wireAfter(wire, event) });
    }
  }
};

// Every leave the note can answer is told on the step that made it so, whichever step that is,
// and the rest wait on the note's word.
const told = (before: Open, { effects, state }: Step): Step => {
  const asked = state.kind === "open" ? state.waiters : before.waiters;
  const waiters = asked.filter(({ upTo }) => holdsAt(state, upTo) === null);
  const tells = asked.flatMap((waiter) => telling(state, waiter));
  return at(state.kind === "open" ? { ...state, waiters } : state, [...effects, ...tells]);
};

const step = (state: State, event: NoteEvent): Step => {
  if (event.kind === "holds-asked" && state.kind !== "open") {
    return at(state, telling(state, { resolve: event.resolve, upTo: 0 }));
  }
  switch (state.kind) {
    case "idle":
    case "missing": {
      if (event.kind === "start") {
        const { offline } = event;
        const doc = new Y.Doc();
        return at({ doc, kind: "opening", stalled: offline, wire: offline ? PAUSED : DIALING });
      }
      return at(state);
    }
    case "opening": {
      return openingAfter(state, event);
    }
    case "open": {
      return told(state, openAfter(state, event));
    }
    // no default
  }
};

const FRESH: NoteStatus = { kind: "opening", stalled: false };
const STALLED: NoteStatus = { kind: "opening", stalled: true };
const MISSING: NoteStatus = { kind: "missing" };

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
      return {
        doc: state.shown,
        edits: editsOf(state),
        kind: "open",
        unsaved: holdsAt(state, state.edits) !== true,
        unsent: state.unsent,
      };
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
    a.unsaved === b.unsaved &&
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

// a document whose edits reach the step, until `stop`
interface Watch {
  readonly doc: Y.Doc;
  readonly stop: () => void;
}

const GRACE_OVER: NoteEvent = { kind: "grace-over" };

class LiveNote implements NoteConnection {
  private readonly itemId: string;
  private readonly host: NoteHost;
  private readonly listeners = new Set<() => void>();
  // assigned only by `dispatch`
  private state: State = IDLE;
  private current: NoteStatus = FRESH;
  // what follows the state
  private link: NoteSocket | null = null;
  private watched: Watch | null = null;
  private unlisten: (() => void) | null = null;
  private grace: ReturnType<typeof setTimeout> | undefined;

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

  readonly holds = async (): Promise<boolean> => {
    const { promise, resolve } = deferred<boolean>();
    this.dispatch({ kind: "holds-asked", resolve });
    return await promise;
  };

  readonly start = (): void => {
    this.dispatch({ kind: "start", offline: !this.host.reach.get() });
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

  // the socket, the grace and the listeners the state wants, and none it does not
  private follow(): void {
    const running = runningOf(this.state);
    this.listen(running !== null);
    this.watch(this.state.kind === "open" ? this.state.shown : null);
    this.dialTo(running?.doc ?? null);
    this.arm(running?.wire.kind === "dialing" && running.wire.grace === "within");
  }

  private run(effect: Effect): void {
    switch (effect.kind) {
      case "tell": {
        effect.resolve(effect.holds);
        break;
      }
      case "ask": {
        this.link?.say(NOTE_SOCKET.savedAsk);
        break;
      }
      // no default
    }
  }

  // the host's word on its reach, and a page shown again, which pings a socket that may not have
  // outlived a sleep
  private listen(on: boolean): void {
    if (on && this.unlisten === null) {
      const { reach } = this.host;
      const probe = (): void => {
        this.link?.probe();
      };
      const onVisibility = (): void => {
        if (document.visibilityState === "visible") {
          probe();
        }
      };
      const stopReach = reach.subscribe(() => {
        this.dispatch({ kind: "host", offline: !reach.get() });
      });
      window.addEventListener("pageshow", probe);
      document.addEventListener("visibilitychange", onVisibility);
      this.unlisten = () => {
        stopReach();
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

  // this device's edits to `doc`: every update but the socket's, which carries the note's own
  private watching(doc: Y.Doc): Watch {
    const onUpdate = doc.on("update", (_update, origin) => {
      if (origin !== this.link) {
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

  // one socket over the document the state dials, whose every word reaches the step while it is
  // that one
  private dialTo(doc: Y.Doc | null): void {
    const { link } = this;
    if (link !== null && link.doc !== doc) {
      this.link = null;
      link.close();
    }
    if (doc !== null && this.link === null) {
      const next: NoteSocket = new NoteSocket({
        doc,
        heard: (event) => {
          if (this.link === next) {
            this.dispatch(event);
          }
        },
        itemId: this.itemId,
        origin: this.host.socketOrigin,
        reach: this.host.reach,
        ticket: this.host.socketTicket,
      });
      this.link = next;
    }
  }

  private arm(on: boolean): void {
    if (on && this.grace === undefined) {
      this.grace = setTimeout(() => {
        this.grace = undefined;
        this.dispatch(GRACE_OVER);
      }, DOWN_GRACE_MS);
    } else if (!on && this.grace !== undefined) {
      clearTimeout(this.grace);
      this.grace = undefined;
    }
  }
}

// inert until `start`, so a connection a discarded render makes leaves nothing running
export const noteConnection = (itemId: string, host: NoteHost): NoteConnection =>
  new LiveNote(itemId, host);
