import type { Descendant } from "platejs";
import { z } from "zod";

import { alertVariantSchema } from "@repo/contract/library/library-nodes";

const stringValue = z.string();
const numberValue = z.number();

export const stringProp = (node: Descendant, key: string) => {
  const parsed = stringValue.safeParse(node[key]);

  return parsed.success ? parsed.data : undefined;
};

export const blockId = (node: Descendant) => {
  const id = stringProp(node, "id");

  return id === "" ? undefined : id;
};

export const numberProp = (node: Descendant, key: string) => {
  const parsed = numberValue.safeParse(node[key]);

  return parsed.success ? parsed.data : undefined;
};

export const alertProp = (node: Descendant) => {
  const parsed = alertVariantSchema.safeParse(node.alert);

  return parsed.success ? parsed.data : undefined;
};
