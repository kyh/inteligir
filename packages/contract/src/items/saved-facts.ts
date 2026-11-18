import { ITEM_FIELD_CAPS } from "../library/library-item";

interface SavedFacts {
  readonly author: string | null;
  readonly description: string | null;
  readonly lang: string | null;
  readonly published: string | null;
  readonly site: string | null;
}

export const fieldLine = (value: string | null) => {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed.slice(0, ITEM_FIELD_CAPS.line);
};

const descriptionOf = (text: string | null | undefined) => {
  const cut = text?.trim().slice(0, ITEM_FIELD_CAPS.description) ?? "";

  return cut === "" ? null : cut;
};

export const savedFacts = (facts: SavedFacts) =>
  ({
    author: fieldLine(facts.author),
    description: descriptionOf(facts.description),
    lang: fieldLine(facts.lang),
    published: fieldLine(facts.published),
    site: fieldLine(facts.site),
  }) satisfies SavedFacts;
