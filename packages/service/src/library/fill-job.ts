import { isWebUrl } from "@repo/contract/items/item-url";
import { ITEM_FIELD_CAPS } from "@repo/contract/items/item-field-caps";
import { z } from "zod";

const webUrl = z
  .string()
  .max(ITEM_FIELD_CAPS.url)
  .refine(isWebUrl, { error: "is not a web address" });

export const fillJobSchema = z.strictObject({
  itemId: z.string().min(1).max(128),
  url: webUrl,
  coverHint: webUrl.nullable(),
});

export type FillJob = z.infer<typeof fillJobSchema>;
