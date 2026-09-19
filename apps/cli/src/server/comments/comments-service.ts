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
} from "@repo/notes/comments/comment-threads";
import type { SidecarThreads } from "@repo/notes/comments/comment-threads";
import { markerRootIds } from "@repo/notes/comments/marker-ids";
import {
  commentsStorePath,
  isNoteIdKey,
  legacyCommentsSidecarPath,
  parseSidecar,
  serializeSidecar,
} from "@repo/notes/comments/sidecar-schema";
import type { CommentSidecar, CommentSource } from "@repo/notes/comments/sidecar-schema";
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

import { VaultServiceError } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";
import { CommentRefusedError } from "./comment-refused-error";
import { SidecarConflictError } from "./sidecar-conflict-error";
import { SidecarInvalidError } from "./sidecar-invalid-error";

// unix seconds, the store's unit.
export type CommentsClock = () => number;

export interface CommentsService {
  list: (path: string) => Promise<CommentsResponse>;
  add: (args: CommentsAddRequest) => Promise<CommentsResponse>;
  reply: (args: CommentsReplyRequest) => Promise<CommentsResponse>;
  resolve: (args: CommentsResolveRequest) => Promise<CommentsResponse>;
  remove: (args: CommentsRemoveRequest) => Promise<CommentsRemoveResponse>;
  // the beside-the-note sidecar older vaults and agents wrote, folded into the store and removed
  migrateLegacy: (path: string) => Promise<"migrated" | "none">;
}

// an explicit projection, not a spread: the file keeps fields the contract does not declare.
const toWire = (entry: CommentSidecar[string]): CommentEntryWire => {
  const wire: CommentEntryWire = {
    createdAt: entry.createdAt,
    text: entry.text,
    updatedAt: entry.updatedAt,
  };
  if (entry.source !== undefined) {
    wire.source = entry.source;
  }
  if (entry.parentId !== undefined) {
    wire.parentId = entry.parentId;
  }
  if (entry.imageUrls !== undefined) {
    wire.imageUrls = entry.imageUrls;
  }
  if (entry.resolvedAt !== undefined) {
    wire.resolvedAt = entry.resolvedAt;
  }
  if (entry.resolvedBy !== undefined) {
    wire.resolvedBy = entry.resolvedBy;
  }
  return wire;
};

const toResponse = (path: string, folded: SidecarThreads): CommentsResponse => ({
  orphanMarkers: folded.orphanMarkers,
  path,
  strayIds: folded.strayIds,
  threads: folded.threads.slice(0, COMMENTS_THREADS_MAX).map((thread) => ({
    anchored: thread.anchored,
    replies: thread.replies.map((reply) => ({ entry: toWire(reply.entry), id: reply.id })),
    resolved: thread.resolved,
    root: toWire(thread.root),
    rootId: thread.rootId,
  })),
  total: folded.threads.length,
});

interface StoreBase {
  sidecar: CommentSidecar;
  raw: string | null;
}

interface EditApplied {
  ok: true;
  sidecar: CommentSidecar;
}
interface EditRefused {
  ok: false;
  error: string;
}

// the note's bytes and the id they carry; `id` is null for a note that has none yet
interface NoteRead {
  content: string;
  id: string | null;
}

const DEFAULT_SOURCE: CommentSource = "user";

// the key names a file, so an id that cannot is refused rather than escaping the store's folder
const keyOf = (notePath: string, id: string): string => {
  if (!isNoteIdKey(id)) {
    throw new CommentRefusedError(`${notePath}: its id ${JSON.stringify(id)} cannot name a file`);
  }
  return id;
};

export const createCommentsService = (vault: VaultService, now: CommentsClock): CommentsService => {
  const readNote = async (notePath: string): Promise<NoteRead> => {
    const { content } = await vault.read(notePath);
    return { content, id: frontmatterId(content) };
  };

  // A note keeps the id it has. One without is minted one through a guarded write, re-read once
  // if the note moved under it, because the user may be typing in it.
  const ensureNoteId = async (notePath: string, note: NoteRead): Promise<string> => {
    let current = note;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (current.id !== null) {
        return keyOf(notePath, current.id);
      }
      const id = mintNoteId();
      const next = withFrontmatterId(current.content, id);
      if (next === null) {
        throw new CommentRefusedError(
          `${notePath}: the frontmatter is not valid YAML, so no id can be written into it`,
        );
      }
      const result = await vault.writeIfUnchanged(notePath, current.content, next);
      if (result.applied) {
        return id;
      }
      current = await readNote(notePath);
    }
    throw new SidecarConflictError(
      `${notePath} changed under the id write twice; nothing was written`,
    );
  };

  const readStore = async (noteId: string): Promise<StoreBase> => {
    const path = commentsStorePath(noteId);
    let raw: string;
    try {
      ({ content: raw } = await vault.read(path));
    } catch (error) {
      if (error instanceof VaultServiceError && error.code === "not_found") {
        return { raw: null, sidecar: {} };
      }
      throw error;
    }
    const parsed = parseSidecar(raw);
    if (!parsed.ok) {
      throw new SidecarInvalidError(`${path}: ${parsed.error}`);
    }
    return { raw, sidecar: parsed.sidecar };
  };

  const swapStore = async (
    noteId: string,
    base: StoreBase,
    next: CommentSidecar,
  ): Promise<boolean> => {
    const path = commentsStorePath(noteId);
    const content = serializeSidecar(next);
    const result =
      base.raw === null
        ? await vault.writeGuarded(path, content, { ifAbsent: true })
        : await vault.writeIfUnchanged(path, base.raw, content);
    return result.applied;
  };

  // the edit re-runs against the retry's read, so an id the other writer took is refused, not re-applied.
  const commit = async <Applied extends EditApplied>(
    noteId: string,
    edit: (sidecar: CommentSidecar) => Applied | EditRefused,
  ): Promise<Applied> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const base = await readStore(noteId);
      const edited = edit(base.sidecar);
      if (!edited.ok) {
        throw new CommentRefusedError(edited.error);
      }
      if (await swapStore(noteId, base, edited.sidecar)) {
        return edited;
      }
    }
    throw new SidecarConflictError(
      `${commentsStorePath(noteId)} changed under the edit twice; nothing was written`,
    );
  };

  // Entries merge by id with the store's own winning; the legacy file goes only if it is still
  // the bytes that were folded; an unparseable one is reported by its own name and left, since
  // destroying it would destroy the threads it holds.
  const foldLegacy = async (notePath: string, note: NoteRead): Promise<NoteRead> => {
    const legacyPath = legacyCommentsSidecarPath(notePath);
    let raw: string;
    try {
      ({ content: raw } = await vault.read(legacyPath));
    } catch (error) {
      if (error instanceof VaultServiceError && error.code === "not_found") {
        return note;
      }
      throw error;
    }
    const parsed = parseSidecar(raw);
    if (!parsed.ok) {
      throw new SidecarInvalidError(`${legacyPath}: ${parsed.error}`);
    }
    let folded = note;
    if (Object.keys(parsed.sidecar).length > 0) {
      const id = await ensureNoteId(notePath, note);
      folded = { content: note.content, id };
      await commit(id, (store) => ({ ok: true, sidecar: { ...parsed.sidecar, ...store } }));
    }
    await vault.removeIfUnchanged(legacyPath, raw);
    return folded;
  };

  const open = async (notePath: string): Promise<NoteRead> =>
    await foldLegacy(notePath, await readNote(notePath));

  const answer = (notePath: string, note: NoteRead, sidecar: CommentSidecar): CommentsResponse =>
    toResponse(notePath, foldThreads(sidecar, markerRootIds(note.content)));

  // reply, resolve and remove act on a thread that exists, so a note with no id has none of them
  const keyOfOpen = async (notePath: string): Promise<{ note: NoteRead; key: string }> => {
    const note = await open(notePath);
    if (note.id === null) {
      throw new CommentRefusedError(`${notePath} has no comments`);
    }
    return { key: keyOf(notePath, note.id), note };
  };

  return {
    async add({ path, id, text, source = DEFAULT_SOURCE }) {
      const note = await open(path);
      const key = await ensureNoteId(path, note);
      const added = await commit(key, (sidecar) =>
        addRoot(sidecar, { at: now(), id, source, text }),
      );
      return answer(path, note, added.sidecar);
    },

    async list(path) {
      let note: NoteRead;
      try {
        note = await open(path);
      } catch (error) {
        if (error instanceof VaultServiceError && error.code === "not_found") {
          return toResponse(path, foldThreads({}, null));
        }
        throw error;
      }
      if (note.id === null) {
        return answer(path, note, {});
      }
      const { sidecar } = await readStore(keyOf(path, note.id));
      return answer(path, note, sidecar);
    },

    async migrateLegacy(path) {
      const note = await readNote(path);
      const legacyPath = legacyCommentsSidecarPath(path);
      if ((await vault.statEntry(legacyPath)) !== "file") {
        return "none";
      }
      await foldLegacy(path, note);
      return "migrated";
    },

    async remove({ path, id }) {
      const { note, key } = await keyOfOpen(path);
      const deleted = await commit(key, (sidecar) => deleteThread(sidecar, id));
      return { ...answer(path, note, deleted.sidecar), removedIds: deleted.removedIds };
    },

    async reply({ path, id, parentId, text, source = DEFAULT_SOURCE }) {
      const { note, key } = await keyOfOpen(path);
      const added = await commit(key, (sidecar) =>
        addReply(sidecar, { at: now(), id, parentId, source, text }),
      );
      return answer(path, note, added.sidecar);
    },

    async resolve({ path, id, resolved, source = DEFAULT_SOURCE }) {
      const { note, key } = await keyOfOpen(path);
      const next = await commit(key, (sidecar) =>
        resolveThread(sidecar, { at: now(), by: source, resolved, rootId: id }),
      );
      return answer(path, note, next.sidecar);
    },
  };
};
