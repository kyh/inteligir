// What the library cell answers a write it cannot land: a plain value, so it crosses RPC and the
// procedures over the cell (`/v1/rpc/library`, the connector) answer each as its declared error
// (`@repo/contract/v1/errors`). Inside a transaction a refusal is thrown, so everything the
// write did so far rolls back; it is caught at the transaction's edge and never leaves the cell as
// an exception.

import type { editRefusalSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

type EditRefusal = z.infer<typeof editRefusalSchema>;

export type CellRefusal =
  // the account is being deleted
  | { readonly kind: "gone" }
  | { readonly kind: "not-found" }
  // a base the write named no longer holds, or the id it would make is held
  | { readonly kind: "conflict" }
  // a block, an item's text or its fields past their cap
  | { readonly kind: "too-large" }
  | { readonly kind: "quota"; readonly bytesUsed: number; readonly bytesCap: number }
  // files the write names that were never uploaded
  | { readonly kind: "blob-missing"; readonly shas: readonly string[] }
  // the write would give a second live item a url another one holds
  | { readonly kind: "url-held" }
  | { readonly kind: "already-undone"; readonly changeSetId: string }
  // an agent's edit of an item's markdown that cannot land: `edit` is its index in the request
  | { readonly kind: "edit-refused"; readonly refusal: EditRefusal }
  // a page's cursor this library never answered with
  | { readonly kind: "bad-cursor" }
  // the built-in agent cannot be used: this deployment has no Claude to call, its conversation's
  // object could not be reached, or the person turned it off
  | { readonly kind: "agent-unavailable" }
  // the day's allowance of the built-in agent is spent, until `resetsAt`
  | { readonly kind: "agent-budget"; readonly resetsAt: number }
  // the built-in agent's turn the call is one of is no longer open
  | { readonly kind: "turn-ended" }
  // the write brought a body for an item whose note writes it, so it goes again by the note
  // (`./article-landing`); `seq` is the item's as the write met it
  | { readonly kind: "note-opened"; readonly itemId: string; readonly seq: number };

export type CellResult<T> =
  | { readonly ok: true; readonly value: T }
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
