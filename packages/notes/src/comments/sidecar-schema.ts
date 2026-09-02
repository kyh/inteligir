import { z } from "zod";

export function commentsSidecarPath(notePath: string): string {
  return `${notePath}.comments.json`;
}

export const COMMENT_SOURCES = ["user", "agent", "external"] as const;
export const commentSourceSchema = z.enum(COMMENT_SOURCES);
export type CommentSource = z.infer<typeof commentSourceSchema>;

// the marker grammar's alphabet: every key must be legal inside a body marker
export const COMMENT_ID_RE = /^[A-Za-z0-9_-]+$/;
export const commentIdSchema = z.string().regex(COMMENT_ID_RE);

const MINTED_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MINTED_ID_LENGTH = 10;

// globalThis.crypto, not node:crypto: this package is platform-neutral. 36^10
// makes a collision a non-event, so no caller checks.
export function mintCommentId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(MINTED_ID_LENGTH));
  return [...bytes].map((byte) => MINTED_ID_ALPHABET[byte % MINTED_ID_ALPHABET.length]).join("");
}

// looseObject: fields from an external writer this version never heard of must survive a rewrite
export const commentEntrySchema = z.looseObject({
  text: z.string(),
  /** Unix seconds. */
  createdAt: z.number().finite(),
  /** Unix seconds. */
  updatedAt: z.number().finite(),
  source: commentSourceSchema.optional(),
  parentId: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  resolvedAt: z.number().finite().optional(),
  resolvedBy: commentSourceSchema.optional(),
});
export type CommentEntry = z.infer<typeof commentEntrySchema>;

export const commentSidecarSchema = z.record(commentIdSchema, commentEntrySchema);
export type CommentSidecar = z.infer<typeof commentSidecarSchema>;

export type SidecarParse = { ok: true; sidecar: CommentSidecar } | { ok: false; error: string };

// a malformed sidecar must surface: folding it to {} lets the next write erase every thread
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

export function serializeSidecar(sidecar: CommentSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}
