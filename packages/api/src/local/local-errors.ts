// EVERY refusal the local API can answer, in its own module BELOW the router:
// `local-contract` composes the domain contracts, and each of those needs the
// vocabulary, so putting it there makes a value cycle that resolves to
// undefined at module-eval time.
//
// A row declares the classes it can raise, `safe()` narrows on the error
// branch, and there is no `data` to read when a call refused — so "a refusal
// must never be printed as an answer" is not something a helper enforces but
// something the types do not offer.
//
// A CODE IS A CLASS; ITS HTTP STATUS IS DECIDED ONCE, AT THE HANDLER. oRPC v2
// carries no `status` on an error or its contract definition — `defined` (does
// the code match a `.errors` row) is decoupled from the status entirely, so a
// custom class no longer has to restate a number to be a defined refusal. The
// built-in codes (BAD_REQUEST, NOT_FOUND, CONFLICT, PAYLOAD_TOO_LARGE,
// SERVICE_UNAVAILABLE …) get their status from oRPC's own COMMON_ERROR_STATUS_MAP;
// the custom codes below get theirs from `LOCAL_ERROR_STATUS_MAP`, the ONE place
// the handler's `errorStatusMap` and the non-procedure asset route both read.
//
// SPREAD, NEVER INHERITED WHOLESALE. Each contract row names the classes IT
// can raise — the same claim the old per-row status list made — so a client's
// switch stays exhaustive over what can actually arrive. A base carrying every
// class would make every switch carry branches no handler can reach.

import { z } from "zod";

/** A path outside the vault, or one whose grammar the vault refuses. Distinct
 *  from oRPC's BAD_REQUEST, which is what an input schema raises: this one is
 *  the FILESYSTEM's refusal, decided after the value parsed. */
export const INVALID_PATH = {
  message: "That path is not one this vault can address",
} as const;

/** A write refused because the destination already exists (`ifAbsent`), or a
 *  create whose name is taken. */
export const ALREADY_EXISTS = {
  message: "Something is already there",
} as const;

/**
 * The write CAS. `data` carries the file's CURRENT bytes so a client can merge
 * (diff3) and retry — which is the whole reason the guard lives in the
 * protocol rather than in the UI: an agent write landing between a client's
 * read and its save is otherwise silently overwritten.
 *
 * `current` is absent when the file no longer exists at all — a delete that
 * raced the write has nothing to merge against.
 */
export const CAS_MISMATCH = {
  message: "The file changed since it was read",
  data: z.object({
    current: z
      .object({
        content: z.string(),
        hash: z.string().regex(/^[0-9a-f]{64}$/u),
      })
      .strict()
      .optional(),
  }),
} as const;

/** The thread is archived; it takes no more turns. */
export const ARCHIVED = { message: "That thread is archived" } as const;

/** The turn the caller named is not the one that is open — the staleness guard
 *  on a steer. */
export const STALE_TURN = {
  message: "That turn is no longer the open one",
} as const;

/** The open turn will not take a mid-flight message. */
export const NOT_STEERABLE = {
  message: "The running turn cannot be steered",
} as const;

/** An approval that was already answered. */
export const ALREADY_RESOLVED = {
  message: "That interaction was already answered",
} as const;

/** An answer the pending interaction does not offer. */
export const INVALID_RESOLUTION = {
  message: "That is not one of the offered answers",
} as const;

/** No agent runtime is available to take the turn — `/system/status`'s
 *  `agent.detail` says why, so a refusal here is diagnosable from status. */
export const PROVIDER_UNAVAILABLE = {
  message: "No agent runtime is available",
} as const;

/** The runtime existed and refused the turn. */
export const DISPATCH_FAILED = {
  message: "The agent runtime refused the turn",
} as const;

/** The custom codes gathered into ONE registry, so the status map below is
 *  checked EXHAUSTIVE against them (`satisfies`). v1 kept the status ON each
 *  class precisely so it could not be forgotten; with status moved to a map, a
 *  code with no entry would silently default to 500 — this restores the
 *  compile-time "every code has a status" guarantee. */
const LOCAL_ERRORS = {
  INVALID_PATH,
  ALREADY_EXISTS,
  CAS_MISMATCH,
  ARCHIVED,
  STALE_TURN,
  NOT_STEERABLE,
  ALREADY_RESOLVED,
  INVALID_RESOLUTION,
  PROVIDER_UNAVAILABLE,
  DISPATCH_FAILED,
};

/**
 * The HTTP status each CUSTOM local code answers, keyed by the code string the
 * contract rows raise them under. The built-in codes are NOT here; they come
 * from oRPC's `COMMON_ERROR_STATUS_MAP`. Merge the two at the handler
 * (`errorStatusMap`) and the asset route, so one refusal answers the same status
 * on the procedure surface and the raw-HTTP one.
 */
export const LOCAL_ERROR_STATUS_MAP = {
  INVALID_PATH: 400,
  ALREADY_EXISTS: 409,
  CAS_MISMATCH: 409,
  ARCHIVED: 409,
  STALE_TURN: 409,
  NOT_STEERABLE: 409,
  ALREADY_RESOLVED: 409,
  INVALID_RESOLUTION: 400,
  PROVIDER_UNAVAILABLE: 503,
  DISPATCH_FAILED: 503,
} satisfies Record<keyof typeof LOCAL_ERRORS, number>;
