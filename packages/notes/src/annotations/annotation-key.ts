// The id a note's annotation store is keyed by, read from the note's own text. A new annotation on a note
// without one mints it by the frontmatter id line cut the desktop runs, so the refusals are the
// server's: frontmatter that cannot be read, an id that is not text, an id that cannot name a file.

import { frontmatterId, withFrontmatterId } from "../markdown/frontmatter";
import { isNoteIdKey } from "./store-schema";

// `content` is the note's text with its id, which a mint adds to
export type AnnotationKey =
  | { readonly kind: "key"; readonly id: string; readonly content: string }
  | { readonly kind: "refused"; readonly message: string };

const refused = (message: string): AnnotationKey => ({ kind: "refused", message });

// the id of the store a note's annotations live in; null for a note without an id, or with one no
// file can be named by
export const annotationStoreKey = (content: string): string | null => {
  const id = frontmatterId(content);
  return id !== null && isNoteIdKey(id) ? id : null;
};

const keyed = (id: string, content: string): AnnotationKey =>
  isNoteIdKey(id)
    ? { content, id, kind: "key" }
    : refused("This item's id can't name a file, so it can't take a highlight.");

// `mint` is null for an edit of a thread that exists, a reply or a resolve, which never adds an id
export const annotationKeyOf = (content: string, mint: (() => string) | null): AnnotationKey => {
  if (mint === null) {
    const id = frontmatterId(content);
    return id === null ? refused("This item has no highlights.") : keyed(id, content);
  }
  const minted = mint();
  const verdict = withFrontmatterId(content, minted);
  switch (verdict.kind) {
    case "unchanged": {
      return keyed(verdict.id, content);
    }
    case "written": {
      return keyed(minted, verdict.content);
    }
    case "invalid": {
      return refused("This item's properties can't be read, so it can't take a highlight.");
    }
    case "foreign-id": {
      return refused("This item's id isn't text, so it can't take a highlight.");
    }
    // no default
  }
};

// any id a file can carry gets the same verdict, so asking whether a note takes a new annotation
// mints nothing
const PROBE_ID = "probe";

// why a new annotation on this text would be refused; null when it would not
export const newAnnotationRefusal = (content: string): string | null => {
  const key = annotationKeyOf(content, () => PROBE_ID);
  return key.kind === "refused" ? key.message : null;
};
