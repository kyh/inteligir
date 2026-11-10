// One note's live body: a y-partyserver YServer per note, named by its account and item
// (`./note-stub`). Its Yjs state is its own SQLite: every update appended as it lands, inside the
// event that took it, so the output gate holds the broadcast until the row commits, and folded into
// a snapshot on the debounced save, which then pushes the body's projection to the account's cell,
// ordered by the count of updates stored. Its first load seeds it from the body the cell kept,
// persisting the seed before the cell drops its copy. The agent edits it through a headless editor
// bound to the document under its turn's origin, and each edit is logged so the turn can be undone
// from bytes alone. One alarm backs every deadline: a projection the cell did not take, one the
// debounce never reached, a confirm the cell did not answer, and the turn log's prune.

import { NOTE_SOCKET } from "@repo/contract/library/library-socket";
import { deriveBody } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { applyBodyChanges } from "@repo/editor/live/body-change";
import type { BodyChange, BodyChangeOutcome } from "@repo/editor/live/body-change";
import { readBlocks, seedDoc } from "@repo/editor/live/note-blocks";
import { noteRoot, yjsBindingPlugin } from "@repo/editor/live/yjs-binding";
import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { YjsEditor } from "@slate-yjs/core";
import {
  appliedOps,
  noteMeta,
  noteUpdates,
  snapshotParts,
  turnCursors,
  turnLog,
} from "@repo/db/note/schema";
import { asc, eq, lt, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import { createSlateEditor } from "platejs";
import { YServer } from "y-partyserver";
import * as Y from "yjs";
import { z } from "zod";

import { UNDO_REACH_MS, PRUNE_EVERY_MS } from "../library/change-set-prune";
import { libraryCell } from "../library/library-cell";
import { errorFields } from "../log";
import { plainText } from "../plain-http";
import { articleChanges } from "./article-body";
import { deadline, dutyColumns, dutyOf, stepDuty } from "./note-duty";
import type { Duty, DutyEvent } from "./note-duty";
import { openWithSchema } from "../object-schema";
import { migrateNote, noteDbOf } from "./note-db";
import type { NoteDb } from "./note-db";
import { frameBytes, frameKind } from "./note-frames";
import { noteNameOf } from "./note-stub";
import type { NoteName } from "./note-stub";
import { noteBlocksSchema, NOTE_HOLDER_HEADER, NOTE_MODE_HEADER } from "./note-wire";
import type {
  ChangeAnswer,
  NoteChange,
  NoteHeld,
  NoteOpening,
  NoteProjection,
  NoteRead,
  TurnUndone,
} from "./note-wire";
import { recordTurnEdit, undoTurn } from "./turn-log";
import type { TurnLogRow } from "./turn-log";

// what one update and the whole note may weigh (owner decision: past either the note turns
// read-only and says why, so typing never fails mid-word)
/** @internal */
export const NOTE_UPDATE_CAP = 1024 * 1024;
/** @internal */
export const NOTE_STATE_CAP = 8 * 1024 * 1024;
// a snapshot part sits well inside a Durable Object's 2 MB row
const SNAPSHOT_PART_BYTES = 1024 * 1024;
// the cell keeps a change set this long after it closes, and prunes once a day
const TURN_LOG_KEPT_MS = UNDO_REACH_MS + PRUNE_EVERY_MS;

const LOAD = Symbol("load");
const DEDUPE = Symbol("dedupe");

const META_ID = 1;

// a socket's own: refused once a frame passed a cap, so it takes nothing more
const connectionStateSchema = z.object({ refused: z.literal(true) });

const MODE_TAG = "mode:";
const SESSION_TAG = "session:";

const sessionTag = (sessionId: string): string => `${SESSION_TAG}${sessionId}`;

const modeOf = (connection: Connection): NoteOpening =>
  connection.tags.includes(`${MODE_TAG}read`) ? "read" : "live";

const refused = (connection: Connection): boolean =>
  connectionStateSchema.safeParse(connection.state).success;

const joined = (parts: readonly Uint8Array[]): Uint8Array => {
  const whole = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
};

const partsOf = (bytes: Uint8Array): Uint8Array[] =>
  Array.from({ length: Math.max(1, Math.ceil(bytes.length / SNAPSHOT_PART_BYTES)) }, (_, part) =>
    bytes.slice(part * SNAPSHOT_PART_BYTES, (part + 1) * SNAPSHOT_PART_BYTES),
  );

// who wrote an update: a socket's connection, which y-partyserver reads it from, or a name the
// note and the cell's writers give theirs
type UpdateOrigin = WebSocket | string | symbol | null;

// one top-level element of the document, as the root's delta holds it
const rootPartsSchema = z.array(z.object({ insert: z.unknown() }));
const blockIdSchema = z.string();

type TurnRecord = ReturnType<typeof recordTurnEdit>;

export class NoteDO extends YServer<Env> {
  static override options = { hibernate: true };

  // stated whole, since y-partyserver merges these with `||`
  static override callbackOptions = { debounceMaxWait: 5000, debounceWait: 1000 };

  // what storage holds of the state, which the cap weighs; read again on every load
  #bytes = 0;
  // the item is purged, or the cell says a note asking for its seed lost the body it took
  #gone = false;
  #full = false;
  #deleted = false;
  #rootChanged = false;
  // the alarm set by this instance, so a write sets it once
  #alarmAt: number | null = null;

  readonly #onUpdate = (update: Uint8Array, origin: UpdateOrigin): void => {
    this.#append(update, origin instanceof WebSocket);
  };

  readonly #onRootChange = (): void => {
    this.#rootChanged = true;
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(NOTE_SOCKET.ping, NOTE_SOCKET.pong),
    );
    openWithSchema(ctx, "note", migrateNote);
  }

  get #db(): NoteDb {
    return noteDbOf(this.ctx.storage);
  }

  get #note(): NoteName {
    const named = noteNameOf(this.name);
    if (named === null) {
      throw new Error(`a note's object under a name no note has: ${this.name}`);
    }
    return named;
  }

  #cell() {
    return libraryCell(this.ctx.exports, this.#note.accountId);
  }

  #meta() {
    const db = this.#db;
    db.insert(noteMeta).values({ id: META_ID }).onConflictDoNothing().run();
    const row = db.select().from(noteMeta).where(eq(noteMeta.id, META_ID)).get();
    if (row === undefined) {
      throw new Error("a note without its meta row");
    }
    return row;
  }

  #setMeta(values: SQLiteUpdateSetSource<typeof noteMeta>): void {
    this.#db.update(noteMeta).set(values).where(eq(noteMeta.id, META_ID)).run();
  }

  // what the note owes the cell after `event`, written with `also`; the alarm is the caller's
  #owe(event: DutyEvent, also: SQLiteUpdateSetSource<typeof noteMeta> = {}): Duty {
    const duty = stepDuty(dutyOf(this.#meta()), event);
    this.#setMeta({ ...dutyColumns(duty), ...also });
    return duty;
  }

  #step(event: DutyEvent, also: SQLiteUpdateSetSource<typeof noteMeta> = {}): void {
    this.#rearm(this.#owe(event, also));
  }

  // every update the document takes, stored in the event that took it
  #append(update: Uint8Array, personal: boolean): void {
    this.#db.insert(noteUpdates).values({ bytes: update }).run();
    this.#step(
      { at: Date.now(), kind: "appended" },
      {
        personEdited: personal ? 1 : noteMeta.personEdited,
        version: sql`${noteMeta.version} + 1`,
      },
    );
    this.#bytes += update.length;
  }

  // ---- loading, seeding, saving ----

  // partyserver starts the server again on this instance after a start that threw, so nothing in
  // memory carries over from a failed run, and the stored state is read whole each time; applying
  // it to a document that already holds it changes nothing
  override async onLoad(): Promise<void> {
    this.document.off("update", this.#onUpdate);
    noteRoot(this.document).unobserve(this.#onRootChange);
    this.#alarmAt = null;
    const meta = this.#meta();
    this.#full = meta.full === 1;
    this.#deleted = meta.deleted === 1;
    this.#gone = meta.purged === 1;
    const parts = this.#db
      .select({ bytes: snapshotParts.bytes })
      .from(snapshotParts)
      .orderBy(asc(snapshotParts.part))
      .all()
      .map((row) => row.bytes);
    const updates = this.#db
      .select({ bytes: noteUpdates.bytes })
      .from(noteUpdates)
      .orderBy(asc(noteUpdates.id))
      .all()
      .map((row) => row.bytes);
    this.#bytes = [...parts, ...updates].reduce((sum, bytes) => sum + bytes.length, 0);
    if (parts.length > 0) {
      Y.applyUpdate(this.document, joined(parts), LOAD);
    }
    for (const update of updates) {
      Y.applyUpdate(this.document, update, LOAD);
    }
    if (parts.length === 0 && updates.length === 0 && !this.#gone) {
      await this.#seed();
    } else if (dutyOf(meta).seed.kind !== "none") {
      await this.#confirmSeed();
    }
    this.#rearm(dutyOf(this.#meta()));
    // after the last await, so a run that throws registers nothing and the stored state is not
    // stored again, and before y-partyserver's own listeners, so a frame's row is written ahead of
    // its broadcast
    this.document.on("update", this.#onUpdate);
    noteRoot(this.document).observe(this.#onRootChange);
  }

  // The body the cell kept, persisted before the cell is told it may drop it, so an abort in
  // between loses nothing; seeded into a document of its own first, so a load that runs again
  // never seeds over a body this one already holds. An empty note gets one paragraph here, so two
  // devices opening it never both write one.
  async #seed(): Promise<void> {
    const seed = await this.#cell().readSeed(this.#note.itemId);
    if (seed.kind === "missing" || seed.kind === "claimed") {
      this.#gone = true;
      return;
    }
    const fresh = new Y.Doc();
    seedDoc(fresh, seed.kind === "seed" ? noteBlocksSchema.parse(seed.blocks) : []);
    const state = Y.encodeStateAsUpdate(fresh);
    const duty = this.ctx.storage.transactionSync(() => {
      this.#db.insert(noteUpdates).values({ bytes: state }).run();
      return this.#owe(
        { at: Date.now(), kind: "seeded" },
        { version: sql`${noteMeta.version} + 1` },
      );
    });
    this.#rearm(duty);
    this.#bytes += state.length;
    Y.applyUpdate(this.document, state, LOAD);
    await this.#confirmSeed();
  }

  // a confirm the cell did not answer is asked again by the alarm
  async #confirmSeed(): Promise<void> {
    try {
      await this.#cell().confirmSeed(this.#note.itemId);
      this.#step({ kind: "seedConfirmed" });
    } catch (error) {
      console.warn({ event: "note-confirm-failed", ...errorFields(error) });
      this.#step({ at: Date.now(), kind: "seedFailed" });
    }
  }

  // the stored rows folded into one snapshot, so a load reads one update and the cap weighs the
  // state rather than its history; a state back under the cap with an update's room takes edits
  #compact(): void {
    const state = Y.encodeStateAsUpdate(this.document);
    const full = state.length + NOTE_UPDATE_CAP > NOTE_STATE_CAP && this.#full;
    this.ctx.storage.transactionSync(() => {
      this.#db.delete(noteUpdates).run();
      this.#db.delete(snapshotParts).run();
      for (const [part, bytes] of partsOf(state).entries()) {
        this.#db.insert(snapshotParts).values({ bytes, part }).run();
      }
      this.#setMeta({ full: full ? 1 : 0 });
    });
    this.#bytes = state.length;
    this.#full = full;
  }

  override async onSave(): Promise<void> {
    if (this.#gone) {
      return;
    }
    this.#compact();
    await this.#project();
  }

  override async onAlarm(): Promise<void> {
    this.#alarmAt = null;
    if (this.#gone) {
      return;
    }
    if (dutyOf(this.#meta()).seed.kind !== "none") {
      await this.#confirmSeed();
    }
    await this.#project();
    this.#db
      .delete(turnLog)
      .where(
        sql`${turnLog.changeSetId} IN (SELECT ${turnCursors.changeSetId} FROM ${turnCursors} WHERE ${turnCursors.at} < ${Date.now() - TURN_LOG_KEPT_MS})`,
      )
      .run();
    this.#db
      .delete(turnCursors)
      .where(lt(turnCursors.at, Date.now() - TURN_LOG_KEPT_MS))
      .run();
    this.#rearm(dutyOf(this.#meta()));
  }

  // the one alarm, at the earliest of what the note owes and the oldest turn log's prune; one that
  // fires with nothing left sets no other
  #rearm(duty: Duty): void {
    const oldest = this.#db
      .select({ at: sql<number | null>`min(${turnCursors.at})` })
      .from(turnCursors)
      .get()?.at;
    const owed = deadline(duty);
    const prune = oldest === null || oldest === undefined ? null : oldest + TURN_LOG_KEPT_MS;
    const at = owed === null || prune === null ? (owed ?? prune) : Math.min(owed, prune);
    if (at === null || at === this.#alarmAt) {
      return;
    }
    this.#alarmAt = at;
    void this.ctx.storage.setAlarm(at);
  }

  #blocks(): BodyBlock[] {
    return readBlocks(this.document);
  }

  #projection(): NoteProjection {
    return {
      ...deriveBody(this.#blocks()),
      bytes: this.#bytes,
      version: this.#meta().version,
    };
  }

  // the body as of now to the cell, unless it already holds that version; one it did not take is
  // sent again from the alarm
  async #project(): Promise<void> {
    const meta = this.#meta();
    if (meta.version <= meta.projected) {
      return;
    }
    const at = Date.now();
    const projection = this.#projection();
    try {
      const answer = await this.#cell().projectNote(this.#note.itemId, projection);
      const now = this.#meta();
      const projected = Math.max(now.projected, projection.version);
      this.#step({ at, kind: "projected", stillDirty: now.version > projected }, { projected });
      if (answer === "gone") {
        this.#gone = true;
      }
    } catch (error) {
      console.warn({ event: "note-project-failed", ...errorFields(error) });
      this.#step({ at: Date.now(), kind: "projectFailed" });
    }
  }

  // ---- sockets ----

  // The door's own headers, never the client's: an upgrade without them was not verified. The
  // server starts before partyserver's fetch would, so a start that throws (the cell unreachable)
  // answers 503 rather than an upgrade carrying the error's stack.
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get(NOTE_HOLDER_HEADER) === null) {
      return plainText(403, "The note takes only a socket its door verified.");
    }
    try {
      await this.__unsafe_ensureInitialized();
    } catch (error) {
      console.warn({ event: "note-start-failed", ...errorFields(error) });
      return plainText(503, "This note can't open right now.");
    }
    return await super.fetch(request);
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- partyserver declares this hook as an instance method
  override onRequest(): Response {
    return plainText(404, "not found");
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- as onRequest
  override getConnectionTags(_connection: Connection, context: ConnectionContext): string[] {
    const { headers } = context.request;
    const mode = headers.get(NOTE_MODE_HEADER) === "read" ? "read" : "live";
    return [sessionTag(headers.get(NOTE_HOLDER_HEADER) ?? ""), `${MODE_TAG}${mode}`];
  }

  override async onConnect(connection: Connection, context: ConnectionContext): Promise<void> {
    if (this.#gone) {
      connection.close(NOTE_SOCKET.missingCode, "This note isn't in your library.");
      return;
    }
    await super.onConnect(connection, context);
    // ahead of the sync, so a device opening a held note never shows it writable; Deleted first,
    // since a restore is the person's first step
    if (modeOf(connection) === "read" || this.#deleted) {
      this.sendCustomMessage(connection, NOTE_SOCKET.deleted);
    } else if (this.#full) {
      this.sendCustomMessage(connection, NOTE_SOCKET.full);
    }
  }

  override isReadOnly(connection: Connection): boolean {
    return (
      modeOf(connection) === "read" ||
      refused(connection) ||
      this.#full ||
      this.#deleted ||
      this.#gone
    );
  }

  // presence is off: an awareness frame is dropped, never applied or sent on
  override handleMessage(connection: Connection, message: WSMessage): void {
    if (frameKind(message) === "awareness") {
      return;
    }
    super.handleMessage(connection, message);
  }

  // A frame that writes is weighed before y-partyserver applies it: past an update's cap the
  // socket is held read-only and told so; past the note's, once a compaction cannot make room,
  // the note is full and every socket is told.
  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    if (frameKind(message) === "write" && !this.isReadOnly(connection)) {
      const size = frameBytes(message);
      if (size > NOTE_UPDATE_CAP) {
        connection.setState({ refused: true });
        this.sendCustomMessage(connection, NOTE_SOCKET.refused);
        return;
      }
      if (this.#bytes + size > NOTE_STATE_CAP) {
        this.#compact();
      }
      if (this.#bytes + size > NOTE_STATE_CAP) {
        this.#full = true;
        this.#setMeta({ full: 1 });
        this.broadcastCustomMessage(NOTE_SOCKET.full);
        return;
      }
    }
    this.#rootChanged = false;
    await super.onMessage(connection, message);
    if (this.#rootChanged) {
      this.#dedupe();
    }
  }

  // Two devices moving one block at once leave two blocks under one id; the note, the document's
  // one writer on the server, keeps the first and deletes the later copy.
  #dedupe(): void {
    const root = noteRoot(this.document);
    const seen = new Set<string>();
    const later: number[] = [];
    for (const [index, { insert }] of rootPartsSchema.parse(root.toDelta()).entries()) {
      if (!(insert instanceof Y.XmlText)) {
        continue;
      }
      const id = blockIdSchema.safeParse(insert.getAttribute("id"));
      if (!id.success) {
        continue;
      }
      if (seen.has(id.data)) {
        later.push(index);
      }
      seen.add(id.data);
    }
    if (later.length === 0) {
      return;
    }
    this.document.transact(() => {
      for (const index of later.toReversed()) {
        root.delete(index, 1);
      }
    }, DEDUPE);
  }

  override onCustomMessage(connection: Connection, message: string): void {
    // every frame this socket sent before the ask is stored, since each update's row is written in
    // the event that took it and the output gate holds this answer until it commits
    if (message === NOTE_SOCKET.savedAsk && !this.isReadOnly(connection)) {
      this.sendCustomMessage(connection, NOTE_SOCKET.saved);
    }
  }

  // ---- what the cell asks ----

  // A plain RPC skips partyserver's start, and an eviction between two calls hands the next one a
  // fresh instance, so every call that reads the document starts the server itself.
  async #ready(): Promise<void> {
    await this.__unsafe_ensureInitialized();
  }

  #held(): NoteHeld | null {
    if (this.#gone) {
      return "gone";
    }
    if (this.#deleted) {
      return "deleted";
    }
    return this.#full ? "full" : null;
  }

  async read(): Promise<NoteRead> {
    await this.#ready();
    return { blocks: this.#blocks(), version: this.#meta().version };
  }

  // the changes through an editor bound to the document under `origin`, connected without
  // normalizing, so binding it writes nothing and the update holds the writer's changes alone;
  // `within` runs the edit, inside whatever it wraps it in
  #applyAs(
    origin: string,
    changes: readonly BodyChange[],
    within: (apply: () => void) => void,
  ): BodyChangeOutcome {
    const editor = createSlateEditor({
      plugins: [
        ...BASE_KIT,
        yjsBindingPlugin({ localOrigin: origin, root: noteRoot(this.document) }),
      ],
    });
    if (!YjsEditor.isYjsEditor(editor)) {
      throw new Error("the note's editor is not bound to its document");
    }
    editor.tf.withoutNormalizing(() => {
      YjsEditor.connect(editor);
    });
    const outcomes: BodyChangeOutcome[] = [];
    try {
      within(() => {
        outcomes.push(applyBodyChanges(editor, changes));
      });
    } finally {
      YjsEditor.disconnect(editor);
    }
    return outcomes[0] ?? { kind: "applied" };
  }

  #movedAnswer(blockIds: readonly string[]): ChangeAnswer {
    const named = new Set(blockIds);
    return {
      blocks: this.#blocks().filter(({ block }) => named.has(block.id)),
      kind: "moved",
    };
  }

  // An agent's edit, once per op id, logged around its update under its change set so the turn
  // can be undone later; answers the body after, whole, which the cell lands.
  async applyChange(change: NoteChange): Promise<ChangeAnswer> {
    await this.#ready();
    if (this.#db.select().from(appliedOps).where(eq(appliedOps.opId, change.opId)).get()) {
      return { kind: "applied", projection: this.#projection() };
    }
    const held = this.#held();
    if (held !== null) {
      return { held, kind: "held" };
    }
    const { changeSetId } = change;
    const recorded: TurnRecord[] = [];
    const outcome = this.#applyAs(change.origin, change.changes, (apply) => {
      if (changeSetId === null) {
        this.document.transact(apply, change.origin);
        return;
      }
      const cursor = this.#db
        .select()
        .from(turnCursors)
        .where(eq(turnCursors.changeSetId, changeSetId))
        .get();
      recorded.push(
        recordTurnEdit(
          this.document,
          { changeSetId, origin: change.origin },
          cursor ?? null,
          apply,
        ),
      );
    });
    if (outcome.kind === "moved") {
      return this.#movedAnswer(outcome.blockIds);
    }
    const [turn] = recorded;
    if (changeSetId !== null && turn !== undefined) {
      this.#keepTurn(changeSetId, turn);
    }
    this.#db.insert(appliedOps).values({ answer: "applied", opId: change.opId }).run();
    return { kind: "applied", projection: this.#projection() };
  }

  #keepTurn(changeSetId: string, recorded: TurnRecord): void {
    const at = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const row of recorded.rows) {
        this.#db.insert(turnLog).values(row).run();
      }
      this.#db
        .insert(turnCursors)
        .values({ at, changeSetId, ...recorded.cursor })
        .onConflictDoUpdate({
          set: { at, seq: recorded.cursor.seq, stateVector: recorded.cursor.stateVector },
          target: turnCursors.changeSetId,
        })
        .run();
    });
    this.#rearm(dutyOf(this.#meta()));
  }

  // a page's article in place of the one the note holds, once per reading
  async replaceArticle(article: readonly LibraryBlock[], fillId: string): Promise<ChangeAnswer> {
    await this.#ready();
    if (this.#db.select().from(appliedOps).where(eq(appliedOps.opId, fillId)).get()) {
      return { kind: "applied", projection: this.#projection() };
    }
    const held = this.#held();
    if (held === "gone") {
      return { held, kind: "held" };
    }
    const changes = articleChanges(this.#blocks(), article);
    const outcome = this.#applyAs(fillId, changes, (apply) => {
      apply();
    });
    if (outcome.kind === "moved") {
      return this.#movedAnswer(outcome.blockIds);
    }
    this.#db.insert(appliedOps).values({ answer: "applied", opId: fillId }).run();
    return { kind: "applied", projection: this.#projection() };
  }

  // A turn's edits here taken back as a forward edit under the undo's own origin, keeping every
  // later change; a turn already undone, or one that never wrote here, changes nothing.
  async undoTurn(changeSetId: string, undoSetId: string): Promise<TurnUndone> {
    await this.#ready();
    const rows: TurnLogRow[] = this.#db
      .select()
      .from(turnLog)
      .where(eq(turnLog.changeSetId, changeSetId))
      .orderBy(asc(turnLog.seq), asc(turnLog.part))
      .all();
    const undone = undoTurn(rows, this.document);
    if (undone.update !== null) {
      Y.applyUpdate(this.document, undone.update, `undo:${undoSetId}`);
    }
    return {
      lostText: undone.lostText,
      personEdited: this.#meta().personEdited === 1,
      projection: undone.update === null ? null : this.#projection(),
    };
  }

  // In Deleted the note takes no edit and says so; restored, every socket is closed so each
  // device opens it again, writable.
  async setDeleted(deleted: boolean): Promise<void> {
    await this.#ready();
    this.#setMeta({ deleted: deleted ? 1 : 0 });
    const was = this.#deleted;
    this.#deleted = deleted;
    if (deleted) {
      this.broadcastCustomMessage(NOTE_SOCKET.deleted);
      return;
    }
    if (was) {
      for (const connection of this.getConnections()) {
        connection.close(NOTE_SOCKET.reopenCode, "This note is back in your library.");
      }
    }
  }

  // a session that ended: its sockets here close, and its next dial meets the end itself
  sever(sessionId: string): void {
    for (const connection of this.getConnections(sessionTag(sessionId))) {
      connection.close(NOTE_SOCKET.revokedCode, "signed out");
    }
  }

  // Deleted for good: marked first, so nothing reloads it; every socket told the note is gone;
  // the alarm and then the storage deleted and made durable before the call is answered; the
  // instance ends on the next turn, so nothing it held in memory outlives the purge.
  async purge(): Promise<void> {
    this.#gone = true;
    this.#setMeta({ purged: 1 });
    for (const connection of this.getConnections()) {
      connection.close(NOTE_SOCKET.missingCode, "This note was deleted for good.");
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.sync();
    setTimeout(() => {
      this.ctx.abort("purged");
    }, 0);
  }
}
