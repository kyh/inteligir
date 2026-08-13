// ---------------------------------------------------------------------------
// What the two background stores genuinely share.
//
// Deliberately NOT a generic record store. Delegations and Routines look
// parallel from a distance and are not: their tables carry different columns
// (a delegation has a status and a turn id; a routine has an epoch, a queue
// slot and an in-flight marker), and their updates differ in kind — a
// delegation rewrites its status alongside its record, a routine rewrites the
// record alone under an epoch guard. Parameterizing over that would cost more
// indirection than the duplication it removes, and both tables are DURABLE
// per-user state with no migration story, so a shared writer is a shared way to
// corrupt them.
//
// What IS shared is the one rule neither store may get wrong.
// ---------------------------------------------------------------------------

import { readJson } from "@repo/bridge/wire-helpers";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** How much of an agent's closing text a record keeps. Shared because the two
 * summaries render in the same list and a second number would show as one row
 * truncating where its neighbour did not. */
export const SUMMARY_LEN = 200;

/**
 * A stored record, or `null` when this build cannot read it.
 *
 * Text that will not parse and text that parses into the wrong shape are the
 * SAME fact, and neither may answer with a throw: a `JSON.parse` outside the
 * guard turns a plain `list()` call into an exception. Both arrive here as
 * `null`, and each store projects that into a record naming itself — which is
 * what keeps an unreadable row in the listing rather than vanishing from it.
 */
export function parseRecord<S extends TSchema>(text: string, schema: S): Static<S> | null {
  const parsed = readJson(text);
  return Value.Check(schema, parsed) ? parsed : null;
}
