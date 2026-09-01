// The comments sidecar (`<note>.md.comments.json`). One JSON object keyed by
// comment id; entries validate the fields this app reads and PASS THROUGH
// everything else, because an external writer may hold
// fields this version has never heard of and a rewrite must not eat them.

import { z } from "zod";

/** Where a note's sidecar lives: beside the note, under its full name. The
 * comments service and the trash both derive it, and two spellings that
 * disagree orphan a trashed note's threads. */
export function commentsSidecarPath(notePath: string): string {
  return `${notePath}.comments.json`;
}

export const COMMENT_SOURCES = ["user", "agent", "external"] as const;
export const commentSourceSchema = z.enum(COMMENT_SOURCES);
export type CommentSource = z.infer<typeof commentSourceSchema>;

/** IDs are letters, digits, `_`, `-` — the marker grammar's own alphabet, so
 * every sidecar key could legally appear in a body marker. */
export const COMMENT_ID_RE = /^[A-Za-z0-9_-]+$/;
export const commentIdSchema = z.string().regex(COMMENT_ID_RE);

const MINTED_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MINTED_ID_LENGTH = 10;

/** A fresh comment id: 10 chars of the lowercase marker alphabet, minted the
 * same way by the editor and the CLI so every client's ids share one grammar.
 * Collision is a non-event in the statistical sense (36^10), so no caller
 * checks. `globalThis.crypto` rather than `node:crypto` because this package
 * is platform-neutral. */
export function mintCommentId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(MINTED_ID_LENGTH));
  return [...bytes].map((byte) => MINTED_ID_ALPHABET[byte % MINTED_ID_ALPHABET.length]).join("");
}

export const commentEntrySchema = z.looseObject({
  text: z.string(),
  /** Unix seconds; never changed after creation. */
  createdAt: z.number().finite(),
  /** Unix seconds; bumped on every change to the entry. */
  updatedAt: z.number().finite(),
  /** Absent on legacy entries — preserved as unknown, never backfilled. */
  source: commentSourceSchema.optional(),
  /** Replies only; roots carry none. */
  parentId: z.string().optional(),
  /** Note-relative attachment paths under `assets/`. */
  imageUrls: z.array(z.string()).optional(),
  resolvedAt: z.number().finite().optional(),
  resolvedBy: commentSourceSchema.optional(),
});
export type CommentEntry = z.infer<typeof commentEntrySchema>;

export const commentSidecarSchema = z.record(commentIdSchema, commentEntrySchema);
export type CommentSidecar = z.infer<typeof commentSidecarSchema>;

export type SidecarParse = { ok: true; sidecar: CommentSidecar } | { ok: false; error: string };

/** Parse sidecar bytes. A malformed sidecar is SURFACED, never treated as
 * empty — folding it to `{}` would let the next write erase every thread. */
export function parseSidecar(raw: string): SidecarParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "not JSON" };
  }
  const result = commentSidecarSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "invalid sidecar" };
  }
  return { ok: true, sidecar: result.data };
}

/** Serialize with 2-space indent and a trailing newline — a diffable file a
 * human edits by hand. Insertion order is preserved, so an external
 * writer's ordering survives a rewrite. */
export function serializeSidecar(sidecar: CommentSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}
