// EVERY refusal the local API can answer, in its own module BELOW the router:
// `local-contract` composes the domain contracts, and each of those needs the
// vocabulary, so putting it there makes a value cycle that resolves to
// undefined at module-eval time.
//
// A row declares the classes it can raise, `safe()` narrows on the error
// branch, and there is no `data` to read when a call refused — so "a refusal
// must never be printed as an answer" is not something a helper enforces but
// something the
// types do not offer.
//
// A CODE IS A CLASS, AND ITS STATUS IS A PROPERTY OF THE CLASS. `NOT_FOUND` is
// 404 wherever it comes from; a refusal that answered 404 on one route and 409
// on another would be a client bug nobody could reproduce from the contract.
// The codes oRPC already defines (BAD_REQUEST, NOT_FOUND, CONFLICT,
// PAYLOAD_TOO_LARGE, SERVICE_UNAVAILABLE, INTERNAL_SERVER_ERROR) carry their
// own statuses; the ones below are this domain's own and state theirs.
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
  status: 400,
  message: "That path is not one this vault can address",
} as const;

/** A write refused because the destination already exists (`ifAbsent`), or a
 *  create whose name is taken. */
export const ALREADY_EXISTS = {
  status: 409,
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
  status: 409,
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
export const ARCHIVED = { status: 409, message: "That thread is archived" } as const;

/** The turn the caller named is not the one that is open — the staleness guard
 *  on a steer. */
export const STALE_TURN = {
  status: 409,
  message: "That turn is no longer the open one",
} as const;

/** The open turn will not take a mid-flight message. */
export const NOT_STEERABLE = {
  status: 409,
  message: "The running turn cannot be steered",
} as const;

/** An approval that was already answered. */
export const ALREADY_RESOLVED = {
  status: 409,
  message: "That interaction was already answered",
} as const;

/** An answer the pending interaction does not offer. */
export const INVALID_RESOLUTION = {
  status: 400,
  message: "That is not one of the offered answers",
} as const;

/** No agent runtime is available to take the turn — `/system/status`'s
 *  `agent.detail` says why, so a refusal here is diagnosable from status. */
export const PROVIDER_UNAVAILABLE = {
  status: 503,
  message: "No agent runtime is available",
} as const;

/** The runtime existed and refused the turn. */
export const DISPATCH_FAILED = {
  status: 503,
  message: "The agent runtime refused the turn",
} as const;
