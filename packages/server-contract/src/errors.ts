// Every refusal the local API can answer, in its own module BELOW the route
// table: `routes` composes the domain tables, and each of those needs the
// error envelope, so putting it in `routes` makes a value cycle that resolves
// to undefined at module-eval time.

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
