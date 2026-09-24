// The one place a node's dialect field (riding TElement's open index signature as `unknown`)
// becomes a domain value; a missing field reads `undefined` so the caller states its fallback.

import type { Descendant } from "platejs";
import { z } from "zod";

const stringValue = z.string();
const numberValue = z.number();

export const stringProp = (node: Descendant, key: string): string | undefined => {
  const parsed = stringValue.safeParse(node[key]);
  return parsed.success ? parsed.data : undefined;
};

// NodeIdPlugin mints an id for a block whose id is missing or empty, so an empty one names no block.
export const blockId = (node: Descendant): string | undefined => {
  const id = stringProp(node, "id");
  return id === "" ? undefined : id;
};

export const numberProp = (node: Descendant, key: string): number | undefined => {
  const parsed = numberValue.safeParse(node[key]);
  return parsed.success ? parsed.data : undefined;
};
