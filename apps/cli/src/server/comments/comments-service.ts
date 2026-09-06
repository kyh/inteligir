// the store is an ordinary vault file, so containment, notify, auto-commit and sync ride the write.
// every mutation is a cas against the bytes it was folded from: the panel and the agent's cli are two
// writers of one file, and a plain write lets the second erase the first's entry. one retry is safe
// because every comment edit is additive over ids.

import {
  addReply,
  addRoot,
  deleteThread,
  foldThreads,
  resolveThread,
  type SidecarThreads,
} from "@repo/notes/comments/comment-threads";
import { markerRootIds } from "@repo/notes/comments/marker-ids";
import {
  commentsStorePath,
  isNoteIdKey,
  legacyCommentsSidecarPath,
  parseSidecar,
  serializeSidecar,
  type CommentSidecar,
  type CommentSource,
} from "@repo/notes/comments/sidecar-schema";
import { frontmatterId, mintNoteId, withFrontmatterId } from "@repo/notes/markdown/frontmatter";
import type {
  CommentEntryWire,
  CommentsAddRequest,
  CommentsRemoveRequest,
  CommentsRemoveResponse,
  CommentsReplyRequest,
  CommentsResolveRequest,
  CommentsResponse,
} from "@repo/api/local/comments/comments-schema";
import { COMMENTS_THREADS_MAX } from "@repo/api/local/comments/comments-schema";

import { VaultServiceError, type VaultService } from "../vault/vault-service";

// unix seconds, the store's unit.
export type CommentsClock = () => number;

export interface CommentsService {
  list(path: string): Promise<CommentsResponse>;
  add(args: CommentsAddRequest): Promise<CommentsResponse>;
  reply(args: CommentsReplyRequest): Promise<CommentsResponse>;
  resolve(args: CommentsResolveRequest): Promise<CommentsResponse>;
  remove(args: CommentsRemoveRequest): Promise<CommentsRemoveResponse>;
  // the beside-the-note sidecar older vaults and agents wrote, folded into the store and removed
  migrateLegacy(path: string): Promise<"migrated" | "none">;
}

// not folded to `{}`: an empty fold lets the next write erase every thread an external writer left.
export class SidecarInvalidError extends Error {}

export class SidecarConflictError extends Error {}

export class CommentRefusedError extends Error {}

// an explicit projection, not a spread: the file keeps fields the contract does not declare.
function toWire(entry: CommentSidecar[string]): CommentEntryWire {
  const wire: CommentEntryWire = {
    text: entry.text,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  if (entry.source !== undefined) wire.source = entry.source;
  if (entry.parentId !== undefined) wire.parentId = entry.parentId;
  if (entry.imageUrls !== undefined) wire.imageUrls = entry.imageUrls;
  if (entry.resolvedAt !== undefined) wire.resolvedAt = entry.resolvedAt;
  if (entry.resolvedBy !== undefined) wire.resolvedBy = entry.resolvedBy;
  return wire;
}

function toResponse(path: string, folded: SidecarThreads): CommentsResponse {
  return {
    path,
    threads: folded.threads.slice(0, COMMENTS_THREADS_MAX).map((thread) => ({
      rootId: thread.rootId,
      root: toWire(thread.root),
      replies: thread.replies.map((reply) => ({ id: reply.id, entry: toWire(reply.entry) })),
      resolved: thread.resolved,
      anchored: thread.anchored,
    })),
    total: folded.threads.length,
    orphanMarkers: folded.orphanMarkers,
    strayIds: folded.strayIds,
  };
}

type StoreBase = { sidecar: CommentSidecar; raw: string | null };

type EditApplied = { ok: true; sidecar: CommentSidecar };
type EditRefused = { ok: false; error: string };

// the note's bytes and the id they carry; `id` is null for a note that has none yet
type NoteRead = { content: string; id: string | null };

const DEFAULT_SOURCE: CommentSource = "user";

// the key names a file, so an id that cannot is refused rather than escaping the store's folder
function keyOf(notePath: string, id: string): string {
  if (!isNoteIdKey(id)) {
    throw new CommentRefusedError(`${notePath}: its id ${JSON.stringify(id)} cannot name a file`);
  }
  return id;
}

export function createCommentsService(vault: VaultService, now: CommentsClock): CommentsService {
  async function readNote(notePath: string): Promise<NoteRead> {
    const { content } = await vault.read(notePath);
    return { content, id: frontmatterId(content) };
  }

  // A note keeps the id it has. One without is minted one through a guarded write, re-read once
  // if the note moved under it, because the user may be typing in it.
  async function ensureNoteId(notePath: string, note: NoteRead): Promise<string> {
    let current = note;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (current.id !== null) return keyOf(notePath, current.id);
      const id = mintNoteId();
      const next = withFrontmatterId(current.content, id);
      if (next === null) {
        throw new CommentRefusedError(
          `${notePath}: the frontmatter is not valid YAML, so no id can be written into it`,
        );
      }
      const result = await vault.writeIfUnchanged(notePath, current.content, next);
      if (result.applied) return id;
      current = await readNote(notePath);
    }
    throw new SidecarConflictError(
      `${notePath} changed under the id write twice; nothing was written`,
    );
  }

  async function readStore(noteId: string): Promise<StoreBase> {
    const path = commentsStorePath(noteId);
    let raw: string;
    try {
      raw = (await vault.read(path)).content;
    } catch (error) {
      if (error instanceof VaultServiceError && error.code === "not_found")
        return { sidecar: {}, raw: null };
      throw error;
    }
    const parsed = parseSidecar(raw);
    if (!parsed.ok) throw new SidecarInvalidError(`${path}: ${parsed.error}`);
    return { sidecar: parsed.sidecar, raw };
  }

  async function swapStore(
    noteId: string,
    base: StoreBase,
    next: CommentSidecar,
  ): Promise<boolean> {
    const path = commentsStorePath(noteId);
    const content = serializeSidecar(next);
    const result =
      base.raw === null
        ? await vault.writeGuarded(path, content, { ifAbsent: true })
        : await vault.writeIfUnchanged(path, base.raw, content);
    return result.applied;
  }

  // the edit re-runs against the retry's read, so an id the other writer took is refused, not re-applied.
  async function commit<Applied extends EditApplied>(
    noteId: string,
    edit: (sidecar: CommentSidecar) => Applied | EditRefused,
  ): Promise<Applied> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const base = await readStore(noteId);
      const edited = edit(base.sidecar);
      if (!edited.ok) throw new CommentRefusedError(edited.error);
      if (await swapStore(noteId, base, edited.sidecar)) return edited;
    }
    throw new SidecarConflictError(
      `${commentsStorePath(noteId)} changed under the edit twice; nothing was written`,
    );
  }

  // Entries merge by id with the store's own winning; the legacy file goes only if it is still
  // the bytes that were folded; an unparseable one is reported by its own name and left, since
  // destroying it would destroy the threads it holds.
  async function foldLegacy(notePath: string, note: NoteRead): Promise<NoteRead> {
    const legacyPath = legacyCommentsSidecarPath(notePath);
    let raw: string;
    try {
      raw = (await vault.read(legacyPath)).content;
    } catch (error) {
      if (error instanceof VaultServiceError && error.code === "not_found") return note;
      throw error;
    }
    const parsed = parseSidecar(raw);
    if (!parsed.ok) throw new SidecarInvalidError(`${legacyPath}: ${parsed.error}`);
    let folded = note;
    if (Object.keys(parsed.sidecar).length > 0) {
      const id = await ensureNoteId(notePath, note);
      folded = { content: note.content, id };
      await commit(id, (store) => ({ ok: true, sidecar: { ...parsed.sidecar, ...store } }));
    }
    await vault.removeIfUnchanged(legacyPath, raw);
    return folded;
  }

  async function open(notePath: string): Promise<NoteRead> {
    return foldLegacy(notePath, await readNote(notePath));
  }

  function answer(notePath: string, note: NoteRead, sidecar: CommentSidecar): CommentsResponse {
    return toResponse(notePath, foldThreads(sidecar, markerRootIds(note.content)));
  }

  // reply, resolve and remove act on a thread that exists, so a note with no id has none of them
  async function keyOfOpen(notePath: string): Promise<{ note: NoteRead; key: string }> {
    const note = await open(notePath);
    if (note.id === null) throw new CommentRefusedError(`${notePath} has no comments`);
    return { note, key: keyOf(notePath, note.id) };
  }

  return {
    async list(path) {
      let note: NoteRead;
      try {
        note = await open(path);
      } catch (error) {
        if (error instanceof VaultServiceError && error.code === "not_found")
          return toResponse(path, foldThreads({}, null));
        throw error;
      }
      if (note.id === null) return answer(path, note, {});
      return answer(path, note, (await readStore(keyOf(path, note.id))).sidecar);
    },

    async add({ path, id, text, source = DEFAULT_SOURCE }) {
      const note = await open(path);
      const key = await ensureNoteId(path, note);
      const added = await commit(key, (sidecar) =>
        addRoot(sidecar, { id, text, source, at: now() }),
      );
      return answer(path, note, added.sidecar);
    },

    async reply({ path, id, parentId, text, source = DEFAULT_SOURCE }) {
      const { note, key } = await keyOfOpen(path);
      const added = await commit(key, (sidecar) =>
        addReply(sidecar, { id, parentId, text, source, at: now() }),
      );
      return answer(path, note, added.sidecar);
    },

    async resolve({ path, id, resolved, source = DEFAULT_SOURCE }) {
      const { note, key } = await keyOfOpen(path);
      const next = await commit(key, (sidecar) =>
        resolveThread(sidecar, { rootId: id, resolved, by: source, at: now() }),
      );
      return answer(path, note, next.sidecar);
    },

    async remove({ path, id }) {
      const { note, key } = await keyOfOpen(path);
      const deleted = await commit(key, (sidecar) => deleteThread(sidecar, id));
      return { ...answer(path, note, deleted.sidecar), removedIds: deleted.removedIds };
    },

    async migrateLegacy(path) {
      const note = await readNote(path);
      const legacyPath = legacyCommentsSidecarPath(path);
      if ((await vault.statEntry(legacyPath)) !== "file") return "none";
      await foldLegacy(path, note);
      return "migrated";
    },
  };
}
