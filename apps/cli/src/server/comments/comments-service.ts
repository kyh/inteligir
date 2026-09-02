// the sidecar is an ordinary vault file, so containment, notify, auto-commit and sync ride the write.
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
  commentsSidecarPath,
  parseSidecar,
  serializeSidecar,
  type CommentSidecar,
  type CommentSource,
} from "@repo/notes/comments/sidecar-schema";
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

// unix seconds, the sidecar's unit.
export type CommentsClock = () => number;

export interface CommentsService {
  list(path: string): Promise<CommentsResponse>;
  add(args: CommentsAddRequest): Promise<CommentsResponse>;
  reply(args: CommentsReplyRequest): Promise<CommentsResponse>;
  resolve(args: CommentsResolveRequest): Promise<CommentsResponse>;
  remove(args: CommentsRemoveRequest): Promise<CommentsRemoveResponse>;
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

type SidecarBase = { sidecar: CommentSidecar; raw: string | null };

type EditApplied = { ok: true; sidecar: CommentSidecar };
type EditRefused = { ok: false; error: string };

const DEFAULT_SOURCE: CommentSource = "user";

export function createCommentsService(vault: VaultService, now: CommentsClock): CommentsService {
  async function readSidecar(notePath: string): Promise<SidecarBase> {
    let raw: string;
    try {
      raw = (await vault.read(commentsSidecarPath(notePath))).content;
    } catch (error) {
      if (error instanceof VaultServiceError && error.code === "not_found") {
        return { sidecar: {}, raw: null };
      }
      throw error;
    }
    const parsed = parseSidecar(raw);
    if (!parsed.ok) {
      throw new SidecarInvalidError(`${commentsSidecarPath(notePath)}: ${parsed.error}`);
    }
    return { sidecar: parsed.sidecar, raw };
  }

  async function readNoteMarkers(notePath: string): Promise<Set<string> | null> {
    const { content } = await vault.read(notePath);
    return markerRootIds(content);
  }

  async function swapSidecar(
    notePath: string,
    base: SidecarBase,
    next: CommentSidecar,
  ): Promise<boolean> {
    const path = commentsSidecarPath(notePath);
    const content = serializeSidecar(next);
    const result =
      base.raw === null
        ? await vault.writeGuarded(path, content, { ifAbsent: true })
        : await vault.writeIfUnchanged(path, base.raw, content);
    return result.applied;
  }

  // the edit re-runs against the retry's read, so an id the other writer took is refused, not re-applied.
  async function commit<Applied extends EditApplied>(
    notePath: string,
    edit: (sidecar: CommentSidecar) => Applied | EditRefused,
  ): Promise<Applied> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const base = await readSidecar(notePath);
      const edited = edit(base.sidecar);
      if (!edited.ok) throw new CommentRefusedError(edited.error);
      if (await swapSidecar(notePath, base, edited.sidecar)) return edited;
    }
    throw new SidecarConflictError(
      `${commentsSidecarPath(notePath)} changed under the edit twice; nothing was written`,
    );
  }

  async function answer(notePath: string, sidecar: CommentSidecar): Promise<CommentsResponse> {
    const markers = await readNoteMarkers(notePath).catch(() => null);
    return toResponse(notePath, foldThreads(sidecar, markers));
  }

  return {
    async list(path) {
      return answer(path, (await readSidecar(path)).sidecar);
    },

    async add({ path, id, text, source = DEFAULT_SOURCE }) {
      const markers = await readNoteMarkers(path);
      const added = await commit(path, (sidecar) =>
        addRoot(sidecar, { id, text, source, at: now() }),
      );
      return toResponse(path, foldThreads(added.sidecar, markers));
    },

    async reply({ path, id, parentId, text, source = DEFAULT_SOURCE }) {
      const added = await commit(path, (sidecar) =>
        addReply(sidecar, { id, parentId, text, source, at: now() }),
      );
      return answer(path, added.sidecar);
    },

    async resolve({ path, id, resolved, source = DEFAULT_SOURCE }) {
      const next = await commit(path, (sidecar) =>
        resolveThread(sidecar, { rootId: id, resolved, by: source, at: now() }),
      );
      return answer(path, next.sidecar);
    },

    async remove({ path, id }) {
      const deleted = await commit(path, (sidecar) => deleteThread(sidecar, id));
      const response = await answer(path, deleted.sidecar);
      return { ...response, removedIds: deleted.removedIds };
    },
  };
}
