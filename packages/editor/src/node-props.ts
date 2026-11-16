// The one place a node's dialect field (riding TElement's open index signature as `unknown`)
// becomes a domain value; a missing field reads `undefined` so the caller states its fallback.

import type { Descendant } from "platejs";
import { z } from "zod";

import { alertVariantSchema } from "@repo/contract/library/library-nodes";
import type { AlertVariant } from "@repo/contract/library/library-nodes";

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

// the alert a quote is, where it is one
export const alertProp = (node: Descendant): AlertVariant | undefined => {
  const parsed = alertVariantSchema.safeParse(node.alert);
  return parsed.success ? parsed.data : undefined;
};
