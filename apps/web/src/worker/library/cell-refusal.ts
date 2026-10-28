// What the library cell answers a write it cannot land: a plain value, so it crosses RPC and the
// procedures over the cell (`/v1/rpc/library`, the connector) answer each as its declared error
// (`@repo/contract/cloud/v1-errors`). Inside a transaction a refusal is thrown, so everything the
// write did so far rolls back; it is caught at the transaction's edge and never leaves the cell as
// an exception.

import type {
  conflictCurrentSchema,
  editRefusalSchema,
} from "@repo/contract/cloud/library/library-wire";
import type { z } from "zod";

export type ConflictCurrent = z.infer<typeof conflictCurrentSchema>;
type EditRefusal = z.infer<typeof editRefusalSchema>;

export type CellRefusal =
  // the account is being deleted
  | { readonly kind: "gone" }
  | { readonly kind: "not-found" }
  // what each guarded thing holds now, so the writer merges and sends again
  | { readonly kind: "conflict"; readonly current: readonly ConflictCurrent[] }
  // a block, an item's text, its manifest or its highlights past their cap
  | { readonly kind: "too-large" }
  | { readonly kind: "quota"; readonly bytesUsed: number; readonly bytesCap: number }
  // files the write names that were never uploaded
  | { readonly kind: "blob-missing"; readonly shas: readonly string[] }
  // the write would give a second live item a url another one holds, at the sequence it holds it
  | { readonly kind: "url-held"; readonly itemId: string; readonly seq: number }
  | { readonly kind: "already-undone"; readonly changeSetId: string; readonly undoneBy: string }
  // an agent's edit of an item's markdown that cannot land: `edit` is its index in the request
  | { readonly kind: "edit-refused"; readonly refusal: EditRefusal }
  // a page's cursor this library never answered with
  | { readonly kind: "bad-cursor" };

// `head` is the sequence number the write moved the library to, which the cell's socket ping
// carries, or null when it changed nothing
export type CellResult<T> =
  | { readonly ok: true; readonly value: T; readonly head: number | null }
  | { readonly ok: false; readonly refusal: CellRefusal };

export class RefusedWriteError extends Error {
  readonly refusal: CellRefusal;

  constructor(refusal: CellRefusal) {
    super(`the library refused the write: ${refusal.kind}`);
    this.name = "RefusedWriteError";
    this.refusal = refusal;
  }
}

export const refuse = (refusal: CellRefusal): never => {
  throw new RefusedWriteError(refusal);
};
