// The Slate node boundary. A node's dialect fields — a wiki link's `body`, a
// rich fence's `value`, a callout's `variant` — ride under `TElement`/`TText`'s
// open index signature, so every read of one arrives as `unknown`. These
// schemas are the single place the editor turns such a read into a domain
// value; past them the pipeline works in typed values, and no walk re-decides
// what a field is.
//
// A field the node does not carry reads as `undefined`, which is what lets a
// caller state its own fallback (`?? ""`) beside the read.

import type { Descendant } from "platejs";
import { z } from "zod";

const stringValue = z.string();
const numberValue = z.number();

/** A node's string-valued field. */
export function stringProp(node: Descendant, key: string): string | undefined {
  const parsed = stringValue.safeParse(node[key]);
  return parsed.success ? parsed.data : undefined;
}

/** A node's number-valued field. */
export function numberProp(node: Descendant, key: string): number | undefined {
  const parsed = numberValue.safeParse(node[key]);
  return parsed.success ? parsed.data : undefined;
}
