// The one place a node's dialect field (riding TElement's open index signature as `unknown`)
// becomes a domain value; a missing field reads `undefined` so the caller states its fallback.

import type { Descendant } from "platejs";
import { z } from "zod";

const stringValue = z.string();
const numberValue = z.number();

export function stringProp(node: Descendant, key: string): string | undefined {
  const parsed = stringValue.safeParse(node[key]);
  return parsed.success ? parsed.data : undefined;
}

export function numberProp(node: Descendant, key: string): number | undefined {
  const parsed = numberValue.safeParse(node[key]);
  return parsed.success ? parsed.data : undefined;
}
