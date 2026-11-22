import { deferred } from "@repo/contract/deferred";
import { sameBody } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { HeldNote, NoteSave, NoteSaved } from "@repo/contract/library/held-note";
import { BODY_MAX_BYTES, bodyBytes } from "@repo/contract/library/library-wire";

import { mergeBlocks } from "@repo/editor/headless/body/merge-blocks";
import type { NoteHost, NoteStanding, UnsentNote } from "@repo/editor/host-io";

export const SAVE_PAUSE_MS = 1000;
export const SAVE_MAX_WAIT_MS = 5000;
const KEEPALIVE_MAX_BYTES = 60 * 1024;
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

export interface NoteBody {
  readonly mine: () => BodyBlock[];
  readonly lay: (blocks: readonly BodyBlock[]) => boolean;
}

export type NoteNotice = "conflict" | "deleted" | "agent" | "offline" | "full" | "file-missing";

const TAKES_EDITS: ReadonlySet<NoteNotice> = new Set(["agent", "full", "file-missing", "offline"]);

export const takesNoEdit = (notice: NoteNotice | null) =>
  notice !== null && !TAKES_EDITS.has(notice);

export type NoteView =
  | { readonly kind: "opening"; readonly stalled: boolean }
  | { readonly kind: "missing" }
  | {
      readonly kind: "open";
      readonly drawn: number;
      readonly blocks: readonly BodyBlock[];
      readonly notice: NoteNotice | null;
    };

interface Loaded {
  readonly blocks: readonly BodyBlock[];
  readonly version: number;
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "saving"; readonly request: number; readonly outlives: boolean }
  | { readonly kind: "merging"; readonly request: number }
  | { readonly kind: "failing"; readonly attempt: number }
  | { readonly kind: "conflict"; readonly theirs: HeldNote };

const IDLE: Phase = { kind: "idle" };

const earliest = (a: number | null, b: number | null) => {
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
  private dirtySince: number | null = null;
  private lastEdit = 0;
  private sentSince: number | null = null;
  private flushing = false;
  private behind = false;
  private requests = 0;
  private deleted = false;
  private full = false;
  private fileMissing: readonly BodyBlock[] | null = null;
  private offline = false;
  private kept = false;
  private readonly agentCalls = new Set<string>();
  private readsAsked = 0;
  private reading = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiters = new Set<() => void>();
  private readonly stops: (() => void)[] = [];

  constructor(itemId: string, host: NoteHost) {
    this.itemId = itemId;
    this.host = host;
  }

  readonly view = () => this.current;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return (() => {
      this.listeners.delete(listener);
    }) satisfies () => void;
  };

  readonly start = () => {
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

  readonly close = () => {
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

  readonly bind = (body: NoteBody) => {
    this.body = body;

    return (() => {
      if (this.body === body) {
        this.flush();
        this.body = null;
      }
    }) satisfies () => void;
  };

  readonly edited = () => {
    if (this.closed || this.base === null) {
      return;
    }

    this.lastEdit = Date.now();
    this.dirtySince ??= this.lastEdit;
    this.next();
  };

  readonly flush = () => {
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

  readonly holds = async () => {
    this.flush();

    while (!this.closed && this.awaitsSave()) {
      await this.nextMove();

      if (this.phase.kind === "idle") {
        this.flush();
      }
    }

    return this.closed || !this.unsaved();
  };

  readonly unsaved = () => this.dirtySince !== null || this.phase.kind !== "idle";

  readonly unloadLoses = () => {
    const { phase } = this;

    if (!this.unsaved()) {
      return false;
    }

    const typed = this.body?.mine() ?? null;

    if (this.offline && typed !== null && this.base !== null) {
      this.keep(typed);

      return false;
    }

    if (phase.kind === "saving" && phase.outlives) {
      return this.dirtySince !== null;
    }

    if ((phase.kind !== "idle" && phase.kind !== "saving") || this.blocked()) {
      return true;
    }

    const mine = this.body?.mine() ?? null;

    return mine === null || bodyBytes(mine) > KEEPALIVE_MAX_BYTES;
  };

  readonly agentEditing = (callId: string) => {
    if (this.closed || this.agentCalls.has(callId)) {
      return;
    }

    this.flush();
    this.agentCalls.add(callId);
    this.emit();
  };

  readonly agentEdited = (callId: string) => {
    if (!this.agentCalls.delete(callId)) {
      return;
    }

    this.emit();
    void this.readLatest();
  };

  readonly showLatest = () => {
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

  readonly mine = () => {
    const blocks = this.body?.mine() ?? null;

    return (blocks === null ? null : { blocks, title: this.title }) satisfies {
      readonly title: string;
      readonly blocks: BodyBlock[];
    } | null;
  };

  private async open() {
    let note: HeldNote | null = null;
    const unsent = this.host.unsent.read(this.itemId);

    try {
      note = await this.host.read(this.itemId);
    } catch {
      if (this.closed) {
        return;
      }

      if (unsent === null) {
        this.current = { kind: "opening", stalled: true };
        this.tell();
      } else {
        this.reopen(unsent);
      }

      return;
    }

    if (this.closed) {
      return;
    }

    if (note === null) {
      this.host.unsent.write(this.itemId, null);
      this.current = { kind: "missing" };
      this.tell();

      return;
    }

    if (
      unsent === null ||
      unsent.baseVersion > note.version ||
      sameBody(unsent.blocks, note.blocks)
    ) {
      this.host.unsent.write(this.itemId, null);
      this.loaded(note);
      this.redraw(note.blocks);

      return;
    }

    this.deleted = note.deleted;
    this.reopen(unsent);
  }

  private reopen(unsent: UnsentNote) {
    this.kept = true;
    this.base = { blocks: unsent.baseBlocks, version: unsent.baseVersion };
    this.title = unsent.title;
    this.redraw(unsent.blocks);
    this.lastEdit = Date.now();
    this.dirtySince = this.lastEdit;
    this.next();
  }

  private loaded(note: HeldNote) {
    this.base = { blocks: note.blocks, version: note.version };
    this.title = note.title;
    this.deleted = note.deleted;
  }

  private redraw(blocks: readonly BodyBlock[]) {
    this.body = null;
    this.drawn += 1;
    this.current = { blocks, drawn: this.drawn, kind: "open", notice: this.notice() };
    this.tell();
  }

  private notice() {
    if (this.phase.kind === "conflict") {
      return "conflict" as const;
    }

    if (this.deleted) {
      return "deleted" as const;
    }

    if (this.agentCalls.size > 0) {
      return "agent" as const;
    }

    if (this.offline) {
      return "offline" as const;
    }

    if (this.full) {
      return "full" as const;
    }

    return (this.fileMissing === null ? null : "file-missing") satisfies NoteNotice | null;
  }

  private blocked() {
    return this.phase.kind === "conflict" || this.deleted || this.agentCalls.size > 0;
  }

  private keep(blocks: readonly BodyBlock[]) {
    const { base } = this;

    if (base === null) {
      return;
    }

    this.kept = true;
    this.host.unsent.write(this.itemId, {
      baseBlocks: base.blocks,
      baseVersion: base.version,
      blocks,
      title: this.title,
    });
  }

  private forgetKept() {
    if (this.kept && this.dirtySince === null && this.phase.kind === "idle") {
      this.kept = false;
      this.host.unsent.write(this.itemId, null);
    }
  }

  private awaitsSave() {
    const { kind } = this.phase;

    return kind === "saving" || kind === "merging";
  }

  private next() {
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

  private send(leaving = false) {
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
      this.forgetKept();
      this.emit();

      return;
    }

    if (this.offline) {
      this.keep(blocks);
      this.emit();

      return;
    }

    const bytes = bodyBytes(blocks);
    this.full = bytes > BODY_MAX_BYTES;
    const outlives = bytes <= KEEPALIVE_MAX_BYTES;
    const refused = this.fileMissing !== null && sameBody(blocks, this.fileMissing);

    if (this.full || refused || (leaving && !outlives)) {
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

  private async save(request: number, save: NoteSave, outlives: boolean) {
    let answer: NoteSaved | null = null;

    try {
      answer = await this.host.save(save, outlives);
    } catch {
      answer = null;
    }

    if (this.closed) {
      return;
    }

    if (answer?.kind === "saved" && (this.base === null || answer.version > this.base.version)) {
      this.base = { blocks: save.blocks, version: answer.version };
    }

    const { phase } = this;

    if (phase.kind === "saving" && phase.request === request) {
      this.answered(answer, save.blocks);
    }
  }

  private answered(answer: NoteSaved | null, sent: readonly BodyBlock[]) {
    const unsent = this.sentSince;
    this.sentSince = null;

    if (answer !== null && answer.kind !== "stale") {
      this.fileMissing = answer.kind === "file-missing" ? sent : null;
    }

    if (answer?.kind === "saved") {
      this.phase = IDLE;
      this.forgetKept();

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

      case "file-missing": {
        break;
      }

      case "missing": {
        this.gone();

        return;
      }

      default: {
        throw new Error(`unexpected ${String(answer satisfies never)}`);
      }
    }

    this.phase = IDLE;
    this.flushing = false;
    this.next();
  }

  private fail(attempt: number) {
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

  private async merge() {
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

  private async readLatest() {
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

      const [read] = await Promise.allSettled([this.host.read(this.itemId)]);

      if (read.status === "fulfilled") {
        if (read.value === null) {
          this.gone();
        } else if (!this.closed) {
          this.fresh(read.value);
        }
      }
    }

    this.reading = false;
  }

  private fresh(theirs: HeldNote) {
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

  private seeUnheardEdit() {
    const { base, body } = this;

    if (this.dirtySince !== null || base === null || body === null) {
      return;
    }

    if (!sameBody(body.mine(), base.blocks)) {
      this.lastEdit = Date.now();
      this.dirtySince = this.lastEdit;
    }
  }

  private lay(blocks: readonly BodyBlock[]) {
    if (this.body?.lay(blocks) !== true) {
      this.redraw(blocks);
    }
  }

  private gone() {
    clearTimeout(this.timer);
    this.phase = IDLE;
    this.dirtySince = null;
    this.flushing = false;
    this.current = { kind: "missing" };
    this.tell();
  }

  private stands({ deleted, version }: NoteStanding) {
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

  private reached(online: boolean) {
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

  private onPage() {
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        this.flush();
      }
    };

    const leaving = () => {
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

    return (() => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
    }) satisfies () => void;
  }

  private async nextMove() {
    const moved = deferred();

    const waiter = () => {
      moved.resolve();
    };

    this.waiters.add(waiter);
    await moved.promise;
    this.waiters.delete(waiter);
  }

  private emit() {
    const { current } = this;

    if (current.kind === "open") {
      const notice = this.notice();

      if (notice !== current.notice) {
        this.current = { ...current, notice };
      }
    }

    this.tell();
  }

  private tell() {
    for (const waiter of this.waiters) {
      waiter();
    }

    for (const listener of this.listeners) {
      listener();
    }
  }
}
