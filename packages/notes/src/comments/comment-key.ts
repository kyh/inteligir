// The id a note's comment store is keyed by, read from the note's own text. A new comment on a note
// without one mints it by the frontmatter id line cut the desktop runs, so the refusals are the
// server's: frontmatter that cannot be read, an id that is not text, an id that cannot name a file.

import { frontmatterId, withFrontmatterId } from "../markdown/frontmatter";
import { isNoteIdKey } from "./sidecar-schema";

// `content` is the note's text with its id, which a mint adds to
export type CommentKey =
  | { readonly kind: "key"; readonly id: string; readonly content: string }
  | { readonly kind: "refused"; readonly message: string };

const refused = (message: string): CommentKey => ({ kind: "refused", message });

const keyed = (id: string, content: string): CommentKey =>
  isNoteIdKey(id)
    ? { content, id, kind: "key" }
    : refused("This note's id can't name a file, so it can't take a comment.");

// `mint` is null for an edit of a thread that exists, a reply or a resolve, which never adds an id
export const commentKeyOf = (content: string, mint: (() => string) | null): CommentKey => {
  if (mint === null) {
    const id = frontmatterId(content);
    return id === null ? refused("This note has no comments.") : keyed(id, content);
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
      return refused("This note's properties can't be read, so it can't take a comment.");
    }
    case "foreign-id": {
      return refused("This note's id isn't text, so it can't take a comment.");
    }
    // no default
  }
};

// any id a file can carry gets the same verdict, so asking whether a note takes a new comment
// mints nothing
const PROBE_ID = "probe";

// why a new comment on this text would be refused; null when it would not
export const newCommentRefusal = (content: string): string | null => {
  const key = commentKeyOf(content, () => PROBE_ID);
  return key.kind === "refused" ? key.message : null;
};
