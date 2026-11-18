// What the library answers a write it cannot land: a plain value, which a row answers as its
// declared error (`@repo/contract/rpc/v1-errors`). Inside a write a refusal is thrown, so everything
// the write did so far rolls back; `writeLibrary` catches it at the transaction's edge
// (`./library-store`), and it never leaves the store as an exception.

import type { editRefusalSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

type EditRefusal = z.infer<typeof editRefusalSchema>;

export type LibraryRefusal =
  | { readonly kind: "not-found" }
  // a base the write named no longer holds, or the id it would make is held
  | { readonly kind: "conflict" }
  // a block, an item's text or its fields past their cap
  | { readonly kind: "too-large" }
  | { readonly kind: "quota"; readonly bytesUsed: number; readonly bytesCap: number }
  // files the write names that were never uploaded
  | { readonly kind: "blob-missing"; readonly shas: readonly string[] }
  // a file's bytes that do not hash to the sha it was sent under, or fall short of its size
  | { readonly kind: "blob-mismatch" }
  // a file past BLOB_MAX_BYTES, or more bytes than its upload named
  | { readonly kind: "blob-too-large" }
  // the account was deleted, which takes its library's row along
  | { readonly kind: "gone" }
  // the write would give a second live item a url another one holds
  | { readonly kind: "url-held" }
  // an agent's edit of an item's markdown that cannot land: `edit` is its index in the request
  | { readonly kind: "edit-refused"; readonly refusal: EditRefusal }
  // a new note's markdown no body can hold, for the reason an edit's new text would be refused
  | {
      readonly kind: "markdown-refused";
      readonly fault: Extract<EditRefusal["kind"], "too-deep" | "unstorable">;
    }
  // the built-in agent's turn the write is one of is no longer open
  | { readonly kind: "turn-ended" }
  // another write held the account's lock past the wait, so this one landed nothing and may go again
  | { readonly kind: "busy" };

export type LibraryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: LibraryRefusal };

export class RefusedWriteError extends Error {
  readonly refusal: LibraryRefusal;

  constructor(refusal: LibraryRefusal) {
    super(`the library refused the write: ${refusal.kind}`);
    this.name = "RefusedWriteError";
    this.refusal = refusal;
  }
}

export const refuse = (refusal: LibraryRefusal): never => {
  throw new RefusedWriteError(refusal);
};
