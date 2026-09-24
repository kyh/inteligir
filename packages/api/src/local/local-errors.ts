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

// the classes a VaultServiceError maps to (vault-refusals.ts is typed against these keys); a
// comment-store row spreads them whole. PAYLOAD_TOO_LARGE is reachable from a comment store past
// the vault's read cap.
export const VAULT_REFUSAL_ERRORS = {
  CONFLICT: {},
  INVALID_PATH,
  NOT_FOUND: {},
  PAYLOAD_TOO_LARGE: {},
} as const;

export const ALREADY_EXISTS = {
  message: "Something is already there",
} as const;

// `current` is absent when the file no longer exists: a delete that raced the write has nothing to merge against
export const CAS_MISMATCH = {
  data: z.object({
    current: z
      .object({
        content: z.string(),
        hash: contentHashSchema,
      })
      .strict()
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

// the status map is checked exhaustive against this: a code with no entry would default to 500 silently
const LOCAL_ERRORS = {
  ALREADY_EXISTS,
  ALREADY_RESOLVED,
  ARCHIVED,
  CAS_MISMATCH,
  DISPATCH_FAILED,
  INVALID_PATH,
  INVALID_RESOLUTION,
  PROVIDER_UNAVAILABLE,
  STALE_TURN,
};

export const LOCAL_ERROR_STATUS_MAP = {
  ALREADY_EXISTS: 409,
  ALREADY_RESOLVED: 409,
  ARCHIVED: 409,
  CAS_MISMATCH: 409,
  DISPATCH_FAILED: 503,
  INVALID_PATH: 400,
  INVALID_RESOLUTION: 400,
  PROVIDER_UNAVAILABLE: 503,
  STALE_TURN: 409,
} satisfies Record<keyof typeof LOCAL_ERRORS, number>;
