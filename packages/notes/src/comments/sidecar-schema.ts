import { z } from "zod";

// One dot-folder for what the app owns inside the vault, keyed by the note's frontmatter id so a
// rename or move outside the app strands nothing. The cloud was rejected for it: the anchors live
// in the note's bytes and travel through git, so bodies in a second sync system drift from them.
export const COMMENTS_STORE_DIR = ".inteligir/comments";

// the key must also be a file name; a uuid is, and so is any plain name
const NOTE_ID_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export const isNoteIdKey = (id: string): boolean => NOTE_ID_KEY_RE.test(id);

const STORE_FILE_SUFFIX = ".json";

export const commentsStorePath = (noteId: string): string =>
  `${COMMENTS_STORE_DIR}/${noteId}${STORE_FILE_SUFFIX}`;

export const isCommentsStorePath = (path: string): boolean => {
  const prefix = `${COMMENTS_STORE_DIR}/`;
  return (
    path.startsWith(prefix) &&
    path.endsWith(STORE_FILE_SUFFIX) &&
    isNoteIdKey(path.slice(prefix.length, -STORE_FILE_SUFFIX.length))
  );
};

// The beside-the-note spelling older vaults and older agents still write: recognised so it can be
// folded into the store, never written.
const LEGACY_SIDECAR_SUFFIX = ".comments.json";

export const legacyCommentsSidecarPath = (notePath: string): string =>
  `${notePath}${LEGACY_SIDECAR_SUFFIX}`;

export const isLegacyCommentsSidecarPath = (path: string): boolean =>
  path.endsWith(LEGACY_SIDECAR_SUFFIX);

export const legacySidecarNotePath = (sidecarPath: string): string =>
  sidecarPath.slice(0, -LEGACY_SIDECAR_SUFFIX.length);

export const COMMENT_SOURCES = ["user", "agent", "external"] as const;
export const commentSourceSchema = z.enum(COMMENT_SOURCES);
export type CommentSource = z.infer<typeof commentSourceSchema>;

// Every key must be legal inside a body marker, so the marker grammar is built from this one
// spelling of the alphabet rather than restating it.
export const COMMENT_ID_PATTERN = "[A-Za-z0-9_-]+";
export const COMMENT_ID_RE = new RegExp(`^${COMMENT_ID_PATTERN}$`, "u");
export const commentIdSchema = z.string().regex(COMMENT_ID_RE);

const MINTED_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MINTED_ID_LENGTH = 10;

// The caller injects the bytes: this package names no platform, and not every runtime it ships
// to has globalThis.crypto. 36^10 makes a collision a non-event, so no caller checks.
export const mintCommentId = (randomBytes: (length: number) => Uint8Array): string =>
  [...randomBytes(MINTED_ID_LENGTH)]
    .map((byte) => MINTED_ID_ALPHABET[byte % MINTED_ID_ALPHABET.length])
    .join("");

// looseObject: fields from an external writer this version never heard of must survive a rewrite
/* oxlint-disable sort-keys -- zod emits parsed keys in declaration order, so this is the
   sidecar's on-disk field order; sorting it rewrites every vault's comment files. */
export const commentEntrySchema = z.looseObject({
  text: z.string(),
  /** Unix seconds. */
  createdAt: z.number(),
  /** Unix seconds. */
  updatedAt: z.number(),
  source: commentSourceSchema.optional(),
  parentId: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  resolvedAt: z.number().optional(),
  resolvedBy: commentSourceSchema.optional(),
});
/* oxlint-enable sort-keys */
export type CommentEntry = z.infer<typeof commentEntrySchema>;

export const commentSidecarSchema = z.record(commentIdSchema, commentEntrySchema);
export type CommentSidecar = z.infer<typeof commentSidecarSchema>;

export type SidecarParse = { ok: true; sidecar: CommentSidecar } | { ok: false; error: string };

// a malformed sidecar must surface: folding it to {} lets the next write erase every thread
export const parseSidecar = (raw: string): SidecarParse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "not JSON", ok: false };
  }
  const result = commentSidecarSchema.safeParse(parsed);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "invalid sidecar", ok: false };
  }
  return { ok: true, sidecar: result.data };
};

export const serializeSidecar = (sidecar: CommentSidecar): string =>
  `${JSON.stringify(sidecar, null, 2)}\n`;
