// Every refusal the local API can answer, in its own module BELOW the route
// table: `routes` composes the domain tables, and each of those needs the
// error envelope, so putting it in `routes` makes a value cycle that resolves
// to undefined at module-eval time.

import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

/**
 * EVERY refusal class this API can answer. An enum rather than a string, so a
 * client's switch over a refusal is exhaustive and a new class is a compile
 * error at each place that decides what to do about one — a prose list of
 * examples goes stale silently, and the one this replaced was already false.
 *
 * Grouped by who decides:
 *  - the edge, before any handler runs;
 *  - the vault, whose refusals are about a path, a size or a shadowed name;
 *  - a thread, whose refusals are about which turn is open;
 *  - the last resort.
 */
export const API_ERROR_CODES = [
  "forbidden_origin",
  "invalid_request",
  "not_found",

  "invalid_path",
  "too_large",
  "conflict",
  "already_exists",
  "cas_mismatch",

  "archived",
  "stale_turn",
  "not_steerable",
  "already_resolved",
  "invalid_resolution",
  "provider_unavailable",
  "dispatch_failed",

  "internal",
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/**
 * The HTTP status each refusal class answers with — TOTAL over the vocabulary
 * above, and the ONE place any of them is decided.
 *
 * A status is a property of the CLASS, not of the handler that happened to
 * raise it: `not_found` is a 404 wherever it comes from, and a refusal that
 * answered 404 on one route and 409 on another would be a client bug nobody
 * could reproduce from the contract. Before this, every status was a magic
 * number written at the throw site — `invalid_path` was spelled `400` in five
 * places, and a new code could ship with no status at all because nothing
 * asked for one.
 *
 * `as const satisfies` on purpose: `satisfies` makes the table total (a new
 * code is a compile error HERE, which is where the answer belongs), while
 * `as const` keeps each value a literal — the route machinery pairs output
 * with status, so a handler needs `API_ERROR_STATUS.not_found` to BE `404`
 * rather than merely a status code. Reading it with a union key is legal
 * exactly when every code in that union agrees on one status, which is the
 * right condition for a branch that answers several codes at once.
 */
export const API_ERROR_STATUS = {
  forbidden_origin: 403,
  invalid_request: 400,
  not_found: 404,

  invalid_path: 400,
  too_large: 413,
  conflict: 409,
  already_exists: 409,
  cas_mismatch: 409,

  archived: 409,
  stale_turn: 409,
  not_steerable: 409,
  already_resolved: 409,
  invalid_resolution: 400,
  provider_unavailable: 503,
  dispatch_failed: 503,

  internal: 500,
} as const satisfies Record<ApiErrorCode, ContentfulStatusCode>;

/**
 * Every non-2xx API body. `message` is safe for display — internals never
 * reach it.
 *
 * Deliberately NOT `.strict()`: a refusal body may carry more than these two
 * fields (the vault write's 409 carries the file's current content), and every
 * runtime consumer wants the class and the message out of whichever body
 * arrived. Strictness here is a claim no producer honours, and each consumer
 * paid for it with a `.loose()` at the call site.
 */
export const apiErrorResponseSchema = z.object({
  error: apiErrorCodeSchema,
  message: z.string(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
