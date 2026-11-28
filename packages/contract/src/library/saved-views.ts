import { z } from "zod";

import { ITEM_FIELD_CAPS } from "../items/item-field-caps";
import { itemScopeSchema } from "../library-scope";
import { kindsSchema } from "./library-wire";
import { compareText } from "./order-key";

const SAVED_VIEWS_MAX = 50;

export const savedViewSchema = z.strictObject({
  id: z.uuid(),
  kinds: kindsSchema.optional(),
  name: z.string().trim().min(1).max(ITEM_FIELD_CAPS.line),
  scope: itemScopeSchema,
  words: z.string().trim().min(1).max(500).optional(),
});

export type SavedView = z.infer<typeof savedViewSchema>;

export const savedViewsSchema = z.array(savedViewSchema).max(SAVED_VIEWS_MAX);

const byName = (a: SavedView, b: SavedView) =>
  compareText(a.name, b.name) || compareText(a.id, b.id);

export const viewsWith = (views: readonly SavedView[], view: SavedView) => {
  const kept = views.filter(({ id }) => id !== view.id);

  return kept.length >= SAVED_VIEWS_MAX ? null : [...kept, view].toSorted(byName);
};

export const viewsWithout = (views: readonly SavedView[], id: string) =>
  views.filter((view) => view.id !== id);
