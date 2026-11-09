// what a page says of itself, fitted to the item fields that keep it: the one fitting every
// reader of a page makes (the extension, the cloud's fill), so one page saved from either is the
// same item.

import { ITEM_FIELD_CAPS } from "../library/library-item";

// the facts a page says of itself that an item keeps, as every reader of a page answers them
interface SavedFacts {
  readonly author: string | null;
  readonly description: string | null;
  readonly lang: string | null;
  readonly published: string | null;
  readonly site: string | null;
}

// a one-line fact trimmed and clipped to a line's cap; nothing left is no fact
export const fieldLine = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, ITEM_FIELD_CAPS.line);
};

// a description cut to its cap, and none when it holds only whitespace
const descriptionOf = (text: string | null | undefined): string | null => {
  const cut = text?.trim().slice(0, ITEM_FIELD_CAPS.description) ?? "";
  return cut === "" ? null : cut;
};

// the facts a fill owns, as a save carries them
export const savedFacts = (facts: SavedFacts): SavedFacts => ({
  author: fieldLine(facts.author),
  description: descriptionOf(facts.description),
  lang: fieldLine(facts.lang),
  published: fieldLine(facts.published),
  site: fieldLine(facts.site),
});
