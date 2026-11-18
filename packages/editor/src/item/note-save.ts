// An open note saved whole, a second after the last edit and at most five after the first unsaved
// one, one save in flight at a time, over the version its blocks were read at (`NoteHost.save`).
// A save someone else's beat answers `stale`: the latest is read, merged by block with what is
// typed here (`mergeBlocks`), laid in place and saved again, and a block both sides changed apart
// stops the note, read-only, until the person picks the latest or keeps theirs as a new note. A
// newer version learned while nothing is unsaved is laid in place too. The agent editing the note
// saves it now and holds it read-only until its edit ends, or a minute passes. With no connection
// or in Deleted the note takes no edit; past the most a note holds it stops saving until it is
// shorter. No React and no network: the host's ports do both.

import { deferred } from "@repo/contract/deferred";
import { utf8ByteLength } from "@repo/contract/library/canonical-json";
import { sameBody } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import { BODY_MAX_BYTES } from "@repo/contract/library/library-wire";

import { mergeBlocks } from "@repo/editor/headless/body/merge-blocks";
import type { NoteHost, NoteStanding } from "@repo/editor/host-io";

// the pause a save waits for, and the most an unsaved edit waits while typing goes on
export const SAVE_PAUSE_MS = 1000;
export const SAVE_MAX_WAIT_MS = 5000;
// The most a save sent to outlive the page carries: a browser holds 64 KiB for all of a page's
// keepalive requests together, and the call around the blocks takes some.
const KEEPALIVE_MAX_BYTES = 60 * 1024;
// a save the network failed tries again after these, the last for every try past them
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

// the editor showing the note, once it draws: its blocks as the library would store them, and a
// body laid over them in place, outside its undo; false when it could not be laid there
export interface NoteBody {
  readonly mine: () => BodyBlock[];
  readonly lay: (blocks: readonly BodyBlock[]) => boolean;
}

// Why an open note says something above its text: a block changed here and elsewhere apart, in
// Deleted, held by the agent, no connection, or past the most a note holds. Every one but the last
// takes no edit.
export type NoteNotice = "conflict" | "deleted" | "agent" | "offline" | "full";

export const takesNoEdit = (notice: NoteNotice | null): boolean =>
  notice !== null && notice !== "full";

export type NoteView =
  | { readonly kind: "opening"; readonly stalled: boolean }
  | { readonly kind: "missing" }
  | {
      readonly kind: "open";
      // one more each time the editor is drawn anew, over `blocks`
      readonly drawn: number;
      readonly blocks: readonly BodyBlock[];
      readonly notice: NoteNotice | null;
    };

// what the body stands on: the blocks last read or saved, at their version
interface Loaded {
  readonly blocks: readonly BodyBlock[];
  readonly version: number;
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "saving"; readonly request: number; readonly outlives: boolean }
  // reading the latest, to merge what a stale save carried into it
  | { readonly kind: "merging"; readonly request: number }
  // the network failed the last save, and the next try waits on the timer
  | { readonly kind: "failing"; readonly attempt: number }
  | { readonly kind: "conflict"; readonly theirs: HeldNote };

const IDLE: Phase = { kind: "idle" };

const bytesOf = (blocks: readonly BodyBlock[]): number => utf8ByteLength(JSON.stringify(blocks));

const earliest = (a: number | null, b: number | null): number | null => {
  if (a === null) {
    return b;
  }
  return b === null ? a : Math.min(a, b);
};

export class NoteSaver {
  private readonly itemId: string;
  private readonly host: NoteHost;
  private readonly listeners = new Set<() => void>();
  private current: NoteView = { kind: "opening", stalled: false };
  private started = false;
  private closed = false;
  private body: NoteBody | null = null;
  private base: Loaded | null = null;
  private title = "";
  private drawn = 0;
  private phase: Phase = IDLE;
  // the first edit no save carries yet, and the last edit
  private dirtySince: number | null = null;
  private lastEdit = 0;
  // the first edit the save in flight carries, put back when it does not land
  private sentSince: number | null = null;
  // a save asked for now (a leave, the page going behind, the agent), sent once the one in flight
  // answers
  private flushing = false;
  // a newer version was learned while typing here was unsaved, so it is read once that saves
  private behind = false;
  private requests = 0;
  private deleted = false;
  private full = false;
  private offline = false;
  // the agent's calls editing this note, which its host lets go even when one never ends
  private readonly agentCalls = new Set<string>();
  // reads of the latest asked for, and whether one is in flight
  private readsAsked = 0;
  private reading = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiters = new Set<() => void>();
  private readonly stops: (() => void)[] = [];

  constructor(itemId: string, host: NoteHost) {
    this.itemId = itemId;
    this.host = host;
  }

  readonly view = (): NoteView => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // reads the note and follows it until `close`
  readonly start = (): void => {
    if (this.started) {
      return;
    }
    this.started = true;
    const { reach } = this.host;
    this.offline = !reach.get();
    this.stops.push(
      reach.subscribe(() => {
        this.reached(reach.get());
      }),
      this.host.follow(this.itemId, (standing) => {
        this.stands(standing);
      }),
      this.onPage(),
    );
    void this.open();
  };

  readonly close = (): void => {
    if (this.closed) {
      return;
    }
    this.flush();
    this.closed = true;
    clearTimeout(this.timer);
    this.agentCalls.clear();
    for (const stop of this.stops.splice(0)) {
      stop();
    }
    this.body = null;
    this.tell();
  };

  // the editor drawn over the note, until the unbind it answers, which saves what it holds first
  readonly bind = (body: NoteBody): (() => void) => {
    this.body = body;
    return () => {
      if (this.body === body) {
        this.flush();
        this.body = null;
      }
    };
  };

  // the person changed the editor's blocks
  readonly edited = (): void => {
    if (this.closed || this.base === null) {
      return;
    }
    this.lastEdit = Date.now();
    this.dirtySince ??= this.lastEdit;
    this.next();
  };

  // saves now what is unsaved, or as soon as the save in flight answers
  readonly flush = (): void => {
    if (this.closed || this.base === null) {
      return;
    }
    this.seeUnheardEdit();
    if (this.dirtySince === null) {
      return;
    }
    if (this.phase.kind === "failing") {
      this.phase = IDLE;
    }
    if (this.phase.kind === "idle") {
      this.send();
      return;
    }
    this.flushing = true;
  };

  // whether the library holds every edit made here, once what is unsaved has saved or can't
  readonly holds = async (): Promise<boolean> => {
    this.flush();
    while (!this.closed && this.awaitsSave()) {
      await this.nextMove();
      // an edit told once the save went goes now, not on its beat; a failed save waits its turn
      if (this.phase.kind === "idle") {
        this.flush();
      }
    }
    return this.closed || !this.unsaved();
  };

  // typing here the library doesn't hold yet
  readonly unsaved = (): boolean => this.dirtySince !== null || this.phase.kind !== "idle";

  // typing a close or a reload of the page would lose now: unsaved, and no save that outlives the
  // page holds it or can
  readonly unloadLoses = (): boolean => {
    const { phase } = this;
    if (!this.unsaved()) {
      return false;
    }
    if (phase.kind === "saving" && phase.outlives) {
      return this.dirtySince !== null;
    }
    if ((phase.kind !== "idle" && phase.kind !== "saving") || this.blocked()) {
      return true;
    }
    const mine = this.body?.mine() ?? null;
    return mine === null || bytesOf(mine) > KEEPALIVE_MAX_BYTES;
  };

  // the agent began editing this note in the call `callId`: what is typed is saved now, and the
  // note takes no edit until the call ends
  readonly agentEditing = (callId: string): void => {
    if (this.closed || this.agentCalls.has(callId)) {
      return;
    }
    this.agentCalls.add(callId);
    this.flush();
    this.emit();
  };

  // the agent's call ended, and the note shows what it left
  readonly agentEdited = (callId: string): void => {
    if (!this.agentCalls.delete(callId)) {
      return;
    }
    this.emit();
    void this.readLatest();
  };

  // A block changed here and elsewhere apart: the latest drawn in place of what was typed, which
  // is let go.
  readonly showLatest = (): void => {
    if (this.phase.kind !== "conflict") {
      return;
    }
    const { theirs } = this.phase;
    this.phase = IDLE;
    this.dirtySince = null;
    this.flushing = false;
    this.loaded(theirs);
    this.redraw(theirs.blocks);
    void this.readLatest();
  };

  // what is typed here, with the title a copy of it goes by
  readonly mine = (): { readonly title: string; readonly blocks: BodyBlock[] } | null => {
    const blocks = this.body?.mine() ?? null;
    return blocks === null ? null : { blocks, title: this.title };
  };

  private async open(): Promise<void> {
    let note: HeldNote | null = null;
    try {
      note = await this.host.read(this.itemId);
    } catch {
      if (!this.closed) {
        this.current = { kind: "opening", stalled: true };
        this.tell();
      }
      return;
    }
    if (this.closed) {
      return;
    }
    if (note === null) {
      this.current = { kind: "missing" };
      this.tell();
      return;
    }
    this.loaded(note);
    this.redraw(note.blocks);
  }

  private loaded(note: HeldNote): void {
    this.base = { blocks: note.blocks, version: note.version };
    this.title = note.title;
    this.deleted = note.deleted;
  }

  // the editor drawn anew over `blocks`, what the one it replaces holds let go with it
  private redraw(blocks: readonly BodyBlock[]): void {
    this.body = null;
    this.drawn += 1;
    this.current = { blocks, drawn: this.drawn, kind: "open", notice: this.notice() };
    this.tell();
  }

  private notice(): NoteNotice | null {
    if (this.phase.kind === "conflict") {
      return "conflict";
    }
    if (this.deleted) {
      return "deleted";
    }
    if (this.agentCalls.size > 0) {
      return "agent";
    }
    if (this.offline) {
      return "offline";
    }
    return this.full ? "full" : null;
  }

  // whether a save can't go now; the agent's hold lets one go, so the agent edits over it
  private blocked(): boolean {
    return this.phase.kind === "conflict" || this.deleted || this.offline;
  }

  private awaitsSave(): boolean {
    const { kind } = this.phase;
    return kind === "saving" || kind === "merging";
  }

  // what an idle note does next: save what is unsaved, now when asked or on its beat
  private next(): void {
    clearTimeout(this.timer);
    const { dirtySince } = this;
    if (this.phase.kind !== "idle" || dirtySince === null) {
      this.emit();
      return;
    }
    if (this.flushing) {
      this.send();
      return;
    }
    const due = Math.min(this.lastEdit + SAVE_PAUSE_MS, dirtySince + SAVE_MAX_WAIT_MS);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (this.phase.kind === "idle") {
          this.send();
        }
      },
      Math.max(0, due - Date.now()),
    );
    this.emit();
  }

  // Sends what the editor holds over the base. `leaving`: the page is going away, so the save goes
  // now, to outlive it, over one in flight that would not.
  private send(leaving = false): void {
    const { base, body } = this;
    clearTimeout(this.timer);
    this.flushing = false;
    if (base === null || body === null || this.closed || this.blocked()) {
      this.emit();
      return;
    }
    const blocks = body.mine();
    if (sameBody(blocks, base.blocks)) {
      this.dirtySince = null;
      this.emit();
      return;
    }
    const bytes = bytesOf(blocks);
    this.full = bytes > BODY_MAX_BYTES;
    const outlives = bytes <= KEEPALIVE_MAX_BYTES;
    if (this.full || (leaving && !outlives)) {
      this.emit();
      return;
    }
    this.requests += 1;
    const request = this.requests;
    this.sentSince = earliest(this.sentSince, this.dirtySince);
    this.dirtySince = null;
    this.phase = { kind: "saving", outlives, request };
    this.emit();
    void this.save(request, { baseVersion: base.version, blocks, id: this.itemId }, outlives);
  }

  private async save(request: number, save: NoteSave, outlives: boolean): Promise<void> {
    let answer: NoteSaved | null = null;
    try {
      answer = await this.host.save(save, outlives);
    } catch {
      answer = null;
    }
    if (this.closed) {
      return;
    }
    // a save that landed moves the base though a later request went past it, unless one landed
    // after it
    if (answer?.kind === "saved" && (this.base === null || answer.version > this.base.version)) {
      this.base = { blocks: save.blocks, version: answer.version };
    }
    const { phase } = this;
    if (phase.kind === "saving" && phase.request === request) {
      this.answered(answer);
    }
  }

  private answered(answer: NoteSaved | null): void {
    const unsent = this.sentSince;
    this.sentSince = null;
    if (answer?.kind === "saved") {
      this.phase = IDLE;
      if (this.behind) {
        this.behind = false;
        void this.readLatest();
      }
      this.next();
      return;
    }
    this.dirtySince = earliest(unsent, this.dirtySince);
    if (answer === null) {
      this.fail(0);
      return;
    }
    switch (answer.kind) {
      case "stale": {
        void this.merge();
        return;
      }
      case "full": {
        this.full = true;
        break;
      }
      case "deleted": {
        this.deleted = true;
        break;
      }
      case "missing": {
        this.gone();
        return;
      }
      // no default
    }
    this.phase = IDLE;
    this.flushing = false;
    this.next();
  }

  // the network failed a save or its merge's read: tried again on a widening beat
  private fail(attempt: number): void {
    this.phase = { attempt, kind: "failing" };
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (this.phase.kind === "failing" && this.phase.attempt === attempt) {
          this.phase = IDLE;
          this.send();
          if (this.phase.kind === "idle" && this.dirtySince !== null && !this.blocked()) {
            this.fail(attempt + 1);
          }
        }
      },
      RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)],
    );
    this.emit();
  }

  // the save was made over an older version: the latest read, and what is typed here merged in
  private async merge(): Promise<void> {
    this.requests += 1;
    const request = this.requests;
    this.phase = { kind: "merging", request };
    this.emit();
    let theirs: HeldNote | null = null;
    try {
      theirs = await this.host.read(this.itemId);
    } catch {
      if (!this.closed && this.phase.kind === "merging" && this.phase.request === request) {
        this.fail(0);
      }
      return;
    }
    if (this.closed || this.phase.kind !== "merging" || this.phase.request !== request) {
      return;
    }
    if (theirs === null) {
      this.gone();
      return;
    }
    const { base } = this;
    const mine = this.body?.mine() ?? null;
    if (base === null || mine === null) {
      this.phase = IDLE;
      this.next();
      return;
    }
    this.deleted = theirs.deleted;
    this.title = theirs.title;
    const merged = mergeBlocks(base.blocks, mine, theirs.blocks);
    if (merged.kind === "conflict") {
      clearTimeout(this.timer);
      this.flushing = false;
      this.phase = { kind: "conflict", theirs };
      this.emit();
      return;
    }
    this.base = { blocks: theirs.blocks, version: theirs.version };
    this.phase = IDLE;
    this.lay(merged.blocks);
    this.dirtySince ??= Date.now();
    this.send();
  }

  // the latest read, and laid in place when it is newer and nothing typed here is unsaved; one
  // read at a time, and one asked for meanwhile made once it ends
  private async readLatest(): Promise<void> {
    if (this.closed || this.base === null) {
      return;
    }
    this.readsAsked += 1;
    if (this.reading) {
      return;
    }
    this.reading = true;
    let answered = 0;
    while (answered < this.readsAsked && !this.closed) {
      answered = this.readsAsked;
      try {
        const theirs = await this.host.read(this.itemId);
        if (theirs === null) {
          this.gone();
        } else if (!this.closed) {
          this.fresh(theirs);
        }
      } catch {
        // the next beat, focus or reconnect reads again
      }
    }
    this.reading = false;
  }

  private fresh(theirs: HeldNote): void {
    const { base } = this;
    this.deleted = theirs.deleted;
    this.title = theirs.title;
    if (base !== null && theirs.version > base.version) {
      this.seeUnheardEdit();
      if (this.phase.kind === "idle" && this.dirtySince === null) {
        this.loaded(theirs);
        this.lay(theirs.blocks);
      } else {
        this.behind = true;
      }
    }
    this.next();
  }

  // The editor tells of an edit a moment after it lands, once its change settles, so one made just
  // before a leave or a newer body is read off the editor itself, rather than saved over or lost.
  private seeUnheardEdit(): void {
    const { base, body } = this;
    if (this.dirtySince !== null || base === null || body === null) {
      return;
    }
    if (!sameBody(body.mine(), base.blocks)) {
      this.lastEdit = Date.now();
      this.dirtySince = this.lastEdit;
    }
  }

  private lay(blocks: readonly BodyBlock[]): void {
    if (this.body?.lay(blocks) !== true) {
      this.redraw(blocks);
    }
  }

  private gone(): void {
    clearTimeout(this.timer);
    this.phase = IDLE;
    this.dirtySince = null;
    this.flushing = false;
    this.current = { kind: "missing" };
    this.tell();
  }

  private stands({ deleted, version }: NoteStanding): void {
    if (this.closed || this.base === null) {
      return;
    }
    const restored = this.deleted && !deleted;
    this.deleted = deleted;
    if (version > this.base.version || restored) {
      void this.readLatest();
    }
    this.next();
  }

  private reached(online: boolean): void {
    if (this.closed || online !== this.offline) {
      return;
    }
    this.offline = !online;
    if (!online) {
      this.emit();
      return;
    }
    const { current } = this;
    if (current.kind === "opening" && current.stalled) {
      this.current = { kind: "opening", stalled: false };
      void this.open();
      return;
    }
    if (this.phase.kind === "failing") {
      this.phase = IDLE;
    }
    void this.readLatest();
    this.next();
  }

  // Going behind saves now. A page going away sends what is unsaved to outlive it, over a save in
  // flight that would not, since the unload aborts that one; a page holds one such save at a time.
  private onPage(): () => void {
    const hidden = (): void => {
      if (document.visibilityState === "hidden") {
        this.flush();
      }
    };
    const leaving = (): void => {
      const { phase } = this;
      if (phase.kind !== "saving" || phase.outlives) {
        this.flush();
        return;
      }
      this.dirtySince = earliest(this.sentSince, this.dirtySince);
      this.send(true);
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
    };
  }

  private async nextMove(): Promise<void> {
    const moved = deferred();
    const waiter = (): void => {
      moved.resolve();
    };
    this.waiters.add(waiter);
    await moved.promise;
    this.waiters.delete(waiter);
  }

  // the view follows what moved, and a leave waiting on the note looks again
  private emit(): void {
    const { current } = this;
    if (current.kind === "open") {
      const notice = this.notice();
      if (notice !== current.notice) {
        this.current = { ...current, notice };
      }
    }
    this.tell();
  }

  private tell(): void {
    for (const waiter of this.waiters) {
      waiter();
    }
    for (const listener of this.listeners) {
      listener();
    }
  }
}
