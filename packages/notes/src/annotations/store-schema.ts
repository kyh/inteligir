import { z } from "zod";

// One dot-folder for what the app owns inside the vault, keyed by the item's frontmatter id so a
// rename or move outside the app strands nothing. The cloud was rejected for it: the anchors live
// in the note's bytes and travel through git, so bodies in a second sync system drift from them.
export const ANNOTATIONS_STORE_DIR = ".inteligir/annotations";

// the key must also be a file name; a uuid is, and so is any plain name
const NOTE_ID_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export const isNoteIdKey = (id: string): boolean => NOTE_ID_KEY_RE.test(id);

const STORE_FILE_SUFFIX = ".json";

export const annotationsStorePath = (itemId: string): string =>
  `${ANNOTATIONS_STORE_DIR}/${itemId}${STORE_FILE_SUFFIX}`;

// the item id a store path is keyed by; null for any other path
export const annotationsStoreItemId = (path: string): string | null => {
  const prefix = `${ANNOTATIONS_STORE_DIR}/`;
  if (!path.startsWith(prefix) || !path.endsWith(STORE_FILE_SUFFIX)) {
    return null;
  }
  const key = path.slice(prefix.length, -STORE_FILE_SUFFIX.length);
  return isNoteIdKey(key) ? key : null;
};

export const isAnnotationsStorePath = (path: string): boolean =>
  annotationsStoreItemId(path) !== null;

export const ANNOTATION_SOURCES = ["user", "agent", "external"] as const;
export const annotationSourceSchema = z.enum(ANNOTATION_SOURCES);
export type AnnotationSource = z.infer<typeof annotationSourceSchema>;

const ANNOTATION_SOURCE_LABELS = {
  agent: "Agent",
  external: "External",
  user: "You",
} satisfies Record<AnnotationSource, string>;

// every app writer signs its entries, so an unsigned one is an external or legacy writer's and
// claims no author
export const annotationSourceLabel = (source: AnnotationSource | undefined): string =>
  source === undefined ? "—" : ANNOTATION_SOURCE_LABELS[source];

// Every key must be legal inside a body marker, so the marker grammar is built from this one
// spelling of the alphabet rather than restating it.
export const ANNOTATION_ID_PATTERN = "[A-Za-z0-9_-]+";
export const ANNOTATION_ID_RE = new RegExp(`^${ANNOTATION_ID_PATTERN}$`, "u");
export const annotationIdSchema = z.string().regex(ANNOTATION_ID_RE);

const MINTED_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MINTED_ID_LENGTH = 10;

// The caller injects the bytes: this package names no platform, and not every runtime it ships
// to has globalThis.crypto. 36^10 makes a collision a non-event, so no caller checks.
export const mintAnnotationId = (randomBytes: (length: number) => Uint8Array): string =>
  [...randomBytes(MINTED_ID_LENGTH)]
    .map((byte) => MINTED_ID_ALPHABET[byte % MINTED_ID_ALPHABET.length])
    .join("");

// looseObject: fields from an external writer this version never heard of must survive a rewrite.
// zod emits parsed keys in declaration order, so this is the store's on-disk field order;
// sorting it rewrites every vault's annotation files.
export const annotationEntrySchema = z.looseObject({
  // "" is a bare highlight
  text: z.string(),
  // roots only: the passage's plain text when the highlight was made
  quote: z.string().optional(),
  /** Unix seconds. */
  createdAt: z.number(),
  /** Unix seconds. */
  updatedAt: z.number(),
  source: annotationSourceSchema.optional(),
  parentId: z.string().optional(),
});
export type AnnotationEntry = z.infer<typeof annotationEntrySchema>;

// a zod parse emits declared fields in one order, so equal entries stringify equally; an unknown
// field in another order reads as an edit, which only ever keeps an entry
export const sameAnnotationEntry = (
  a: AnnotationEntry | undefined,
  b: AnnotationEntry | undefined,
): boolean =>
  a === undefined || b === undefined ? a === b : JSON.stringify(a) === JSON.stringify(b);

export const annotationStoreSchema = z.record(annotationIdSchema, annotationEntrySchema);
export type AnnotationStore = z.infer<typeof annotationStoreSchema>;

// a Map, not the record: `__proto__` is a legal annotation id
export const annotationEntriesOf = (store: AnnotationStore | null): Map<string, AnnotationEntry> =>
  new Map(Object.entries(store ?? {}));

export type AnnotationStoreParse =
  | { ok: true; store: AnnotationStore }
  | { ok: false; error: string };

// a malformed store must surface: folding it to {} lets the next write erase every annotation
export const parseAnnotationStore = (raw: string): AnnotationStoreParse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "not JSON", ok: false };
  }
  const result = annotationStoreSchema.safeParse(parsed);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "invalid annotation store", ok: false };
  }
  return { ok: true, store: result.data };
};

export const serializeAnnotationStore = (store: AnnotationStore): string =>
  `${JSON.stringify(store, null, 2)}\n`;
