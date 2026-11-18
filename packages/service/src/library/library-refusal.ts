import type { editRefusalSchema } from "@repo/contract/library/library-wire";
import type { z } from "zod";

type EditRefusal = z.infer<typeof editRefusalSchema>;

export type LibraryRefusal =
  | { readonly kind: "not-found" }
  | { readonly kind: "conflict" }
  | { readonly kind: "too-large" }
  | { readonly kind: "quota"; readonly bytesUsed: number; readonly bytesCap: number }
  | { readonly kind: "blob-missing"; readonly shas: readonly string[] }
  | { readonly kind: "blob-mismatch" }
  | { readonly kind: "blob-too-large" }
  | { readonly kind: "gone" }
  | { readonly kind: "url-held" }
  | { readonly kind: "edit-refused"; readonly refusal: EditRefusal }
  | {
      readonly kind: "markdown-refused";
      readonly fault: Extract<EditRefusal["kind"], "too-deep" | "unstorable">;
    }
  | { readonly kind: "turn-ended" }
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
