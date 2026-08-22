// Anchored comments over the vault (issue #583). The sidecar
// (`<note>.md.comments.json`) is an ORDINARY vault file, read and written
// through the VaultService — which is what gives it containment, the watcher's
// files-changed ping, auto-commit and sync for free, and is why this service
// keeps no store of its own. Every mutation is read-modify-write of the whole
// sidecar; the vault's write lock serializes the writes this process makes,
// and an agent editing the same sidecar with its shell is the same external
// writer any vault file already has.

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
  parseSidecar,
  serializeSidecar,
  type CommentSidecar,
} from "@repo/notes/comments/sidecar-schema";
import type {
  CommentEntryWire,
  CommentsRemoveResponse,
  CommentsResponse,
} from "@repo/server-contract/comments";
import { COMMENTS_THREADS_MAX } from "@repo/server-contract/comments";

import { VaultServiceError, type VaultService } from "../vault/vault-service";

/** Unix seconds — the sidecar's own timestamp unit. */
export type CommentsClock = () => number;

export interface CommentsService {
  list(path: string): Promise<CommentsResponse>;
  add(args: { path: string; id: string; text: string }): Promise<CommentsResponse>;
  reply(args: {
    path: string;
    id: string;
    parentId: string;
    text: string;
  }): Promise<CommentsResponse>;
  resolve(args: { path: string; id: string; resolved: boolean }): Promise<CommentsResponse>;
  remove(args: { path: string; id: string }): Promise<CommentsRemoveResponse>;
}

/** A sidecar that exists but does not parse. Refused as a conflict rather
 * than treated as empty: folding it to `{}` would let the next write erase
 * every thread an external writer left there. */
export class SidecarInvalidError extends Error {}

/** A model-level refusal (taken id, missing parent, not a root). */
export class CommentRefusedError extends Error {}

export function sidecarPathFor(notePath: string): string {
  return `${notePath}.comments.json`;
}

/** The wire entry is a strict projection — the FILE keeps fields this version
 * has never heard of; the wire carries only what the contract declares. */
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

export function createCommentsService(vault: VaultService, now: CommentsClock): CommentsService {
  async function readSidecar(notePath: string): Promise<CommentSidecar> {
    let raw: string;
    try {
      raw = (await vault.read(sidecarPathFor(notePath))).content;
    } catch (error) {
      if (error instanceof VaultServiceError && error.code === "not_found") return {};
      throw error;
    }
    const parsed = parseSidecar(raw);
    if (!parsed.ok) {
      throw new SidecarInvalidError(`${sidecarPathFor(notePath)}: ${parsed.error}`);
    }
    return parsed.sidecar;
  }

  /** The note's own bytes — a mutation against a note that is not there is a
   * 404, and the marker set derives from the same read. */
  async function readNoteMarkers(notePath: string): Promise<Set<string> | null> {
    const { content } = await vault.read(notePath);
    return markerRootIds(content);
  }

  async function writeSidecar(notePath: string, sidecar: CommentSidecar): Promise<void> {
    await vault.write(sidecarPathFor(notePath), serializeSidecar(sidecar));
  }

  async function answer(notePath: string, sidecar: CommentSidecar): Promise<CommentsResponse> {
    const markers = await readNoteMarkers(notePath).catch(() => null);
    return toResponse(notePath, foldThreads(sidecar, markers));
  }

  return {
    async list(path) {
      return answer(path, await readSidecar(path));
    },

    async add({ path, id, text }) {
      const markers = await readNoteMarkers(path);
      const sidecar = await readSidecar(path);
      const added = addRoot(sidecar, { id, text, source: "user", at: now() });
      if (!added.ok) throw new CommentRefusedError(added.error);
      await writeSidecar(path, added.sidecar);
      return toResponse(path, foldThreads(added.sidecar, markers));
    },

    async reply({ path, id, parentId, text }) {
      const sidecar = await readSidecar(path);
      const added = addReply(sidecar, { id, parentId, text, source: "user", at: now() });
      if (!added.ok) throw new CommentRefusedError(added.error);
      await writeSidecar(path, added.sidecar);
      return answer(path, added.sidecar);
    },

    async resolve({ path, id, resolved }) {
      const sidecar = await readSidecar(path);
      const next = resolveThread(sidecar, { rootId: id, resolved, by: "user", at: now() });
      if (!next.ok) throw new CommentRefusedError(next.error);
      await writeSidecar(path, next.sidecar);
      return answer(path, next.sidecar);
    },

    async remove({ path, id }) {
      const sidecar = await readSidecar(path);
      const deleted = deleteThread(sidecar, id);
      if (!deleted.ok) throw new CommentRefusedError(deleted.error);
      await writeSidecar(path, deleted.sidecar);
      const response = await answer(path, deleted.sidecar);
      return { ...response, removedIds: deleted.removedIds };
    },
  };
}
