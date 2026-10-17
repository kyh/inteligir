// below the router: local-contract composes the domain contracts and each needs this
// vocabulary, so hosting it there is a value cycle that resolves to undefined at module eval.
// oRPC v2 carries no status on an error: built-in codes take theirs from its
// COMMON_ERROR_STATUS_MAP, custom ones from LOCAL_ERROR_STATUS_MAP below. each contract row
// spreads the classes it can raise; a base carrying every class gives every switch unreachable branches.

import { z } from "zod";
import { contentHashSchema } from "./vault/vault-schema";

// not BAD_REQUEST (an input schema's refusal): the filesystem's, decided after the value parsed
export const INVALID_PATH = {
  message: "That path is not one this vault can address",
} as const;

// the classes a VaultServiceError maps to (vault-refusals.ts is typed against these keys); an
// annotation-store row spreads them whole. PAYLOAD_TOO_LARGE is reachable from an annotation store
// past the vault's read cap.
export const VAULT_REFUSAL_ERRORS = {
  CONFLICT: {},
  INVALID_PATH,
  NOT_FOUND: {},
  PAYLOAD_TOO_LARGE: {},
} as const;

// the classes an AnnotationsError maps to (annotations-router.ts is typed against these keys);
// every annotations row spreads them.
export const ANNOTATIONS_REFUSAL_ERRORS = {
  BAD_REQUEST: {},
  CONFLICT: {},
} as const;

export const ALREADY_EXISTS = {
  message: "Something is already there",
} as const;

// not INVALID_PATH: the path is a valid one, and the list it would join is full
export const LIMIT_REACHED = {
  message: "There is no room for another",
} as const;

// `current` is absent when the file no longer exists: a delete that raced the write has nothing to merge against
export const CAS_MISMATCH = {
  data: z.object({
    current: z
      .strictObject({
        content: z.string(),
        hash: contentHashSchema,
      })
      .optional(),
  }),
  message: "The file changed since it was read",
} as const;

export const ARCHIVED = { message: "That thread is archived" } as const;

export const STALE_TURN = {
  message: "That turn is no longer the open one",
} as const;

export const ALREADY_RESOLVED = {
  message: "That interaction was already answered",
} as const;

export const INVALID_RESOLUTION = {
  message: "That is not one of the offered answers",
} as const;

export const PROVIDER_UNAVAILABLE = {
  message: "No agent runtime is available",
} as const;

export const DISPATCH_FAILED = {
  message: "The agent runtime refused the turn",
} as const;

// a file `imports.plan` cannot read as the source it was told; `reason` says which way it failed
export const IMPORT_UNREADABLE = {
  data: z.object({ reason: z.enum(["not-csv", "no-url-column", "empty"]) }),
  message: "This file isn't a Raindrop export",
} as const;

// the status map is checked exhaustive against this: a code with no entry would default to 500 silently
const LOCAL_ERRORS = {
  ALREADY_EXISTS,
  ALREADY_RESOLVED,
  ARCHIVED,
  CAS_MISMATCH,
  DISPATCH_FAILED,
  IMPORT_UNREADABLE,
  INVALID_PATH,
  INVALID_RESOLUTION,
  LIMIT_REACHED,
  PROVIDER_UNAVAILABLE,
  STALE_TURN,
};

export const LOCAL_ERROR_STATUS_MAP = {
  ALREADY_EXISTS: 409,
  ALREADY_RESOLVED: 409,
  ARCHIVED: 409,
  CAS_MISMATCH: 409,
  DISPATCH_FAILED: 503,
  IMPORT_UNREADABLE: 400,
  INVALID_PATH: 400,
  INVALID_RESOLUTION: 400,
  LIMIT_REACHED: 409,
  PROVIDER_UNAVAILABLE: 503,
  STALE_TURN: 409,
} satisfies Record<keyof typeof LOCAL_ERRORS, number>;
