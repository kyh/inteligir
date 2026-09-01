// Anchored comments over the vault (issue #583). The sidecar
// (`<note>.md.comments.json`) is an ORDINARY vault file, read and written
// through the VaultService — which is what gives it containment, the watcher's
// files-changed ping, auto-commit and sync for free, and is why this service
// keeps no store of its own. Every mutation is a read-modify-write of the
// whole sidecar, and the write is a COMPARE-AND-SWAP against the bytes the
// fold was computed from: the panel and the agent's CLI are two writers of one
// file, and a plain write would let whichever landed second silently erase
// the other's entry. A refused swap is re-read, re-folded and retried ONCE —
// safe here in a way a note-body edit is not, because every comment operation
// is additive over ids — and a second refusal answers the conflict.

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
  CommentsRemoveResponse,
  CommentsResponse,
} from "@repo/api/local/comments/comments-schema";
import { COMMENTS_THREADS_MAX } from "@repo/api/local/comments/comments-schema";

import { VaultServiceError, type VaultService } from "../vault/vault-service";

/** Unix seconds — the sidecar's own timestamp unit. */
export type CommentsClock = () => number;

/** `source` absent means the caller did not say, and the server signs `user`. */
export interface CommentsService {
  list(path: string): Promise<CommentsResponse>;
  add(args: {
    path: string;
    id: string;
    text: string;
    source?: CommentSource | undefined;
  }): Promise<CommentsResponse>;
  reply(args: {
    path: string;
    id: string;
    parentId: string;
    text: string;
    source?: CommentSource | undefined;
  }): Promise<CommentsResponse>;
  resolve(args: {
    path: string;
    id: string;
    resolved: boolean;
    source?: CommentSource | undefined;
  }): Promise<CommentsResponse>;
  remove(args: { path: string; id: string }): Promise<CommentsRemoveResponse>;
}

/** A sidecar that exists but does not parse. Refused as a conflict rather
 * than treated as empty: folding it to `{}` would let the next write erase
 * every thread an external writer left there. */
export class SidecarInvalidError extends Error {}

/** The sidecar changed under the edit twice in a row — the swap was refused,
 * the retry's swap was refused again. Reported rather than retried forever,
 * because a writer that keeps winning is one this process cannot outrun. */
export class SidecarConflictError extends Error {}

/** A model-level refusal (taken id, missing parent, not a root). */
export class CommentRefusedError extends Error {}

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

/** The sidecar as parsed, with the exact bytes it was parsed from — the base
 * the write swaps against. `raw` is null when no sidecar exists yet. */
type SidecarBase = { sidecar: CommentSidecar; raw: string | null };

/** What every `@repo/notes` comment edit answers: the next sidecar (plus
 * whatever else that edit reports) or a model-level refusal. */
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

  /** The note's own bytes — a mutation against a note that is not there is a
   * 404, and the marker set derives from the same read. */
  async function readNoteMarkers(notePath: string): Promise<Set<string> | null> {
    const { content } = await vault.read(notePath);
    return markerRootIds(content);
  }

  /** Swap the sidecar to `next` only if it still holds `base.raw` — or still
   * does not exist, when the base was its absence. */
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

  /** Read, edit, swap; once more from a fresh read if the swap is refused.
   * The edit runs against whatever the retry read, so an edit the newer
   * bytes refuse (an id the other writer already took) is a refusal, never
   * a blind re-apply. */
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
