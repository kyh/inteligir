// An item's facts as a markdown file's frontmatter says them, which an import reads into the
// item's fields (`@repo/editor/codec/item-fields`). YAML-bearing, so the contract never loads it.

import type { ParsedProperties, TypedProperty } from "../markdown/frontmatter";
import { isItemKind } from "@repo/contract/items/item-kind";
import type { ItemKey, ItemKind } from "@repo/contract/items/item-kind";
import { parseItemTime } from "./item-time";
import { isWebUrl } from "@repo/contract/items/item-url";

export interface ItemFacts {
  kind: ItemKind;
  url: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  description: string | null;
  fetchError: string | null;
  savedMs: number | null;
  fetchedMs: number | null;
}

const NOTE_FACTS: ItemFacts = {
  author: null,
  description: null,
  fetchError: null,
  fetchedMs: null,
  kind: "note",
  published: null,
  savedMs: null,
  site: null,
  url: null,
};

const SITE_MAX = 80;
const AUTHOR_MAX = 120;
const PUBLISHED_MAX = 40;

const clip = (text: string, max: number): string => [...text].slice(0, max).join("");

const propertyOf = (
  properties: readonly TypedProperty[],
  key: ItemKey,
): TypedProperty | undefined => properties.find((p) => p.key === key);

// a text or date value, trimmed; "" reads as absent
const textOf = (prop: TypedProperty | undefined): string | null => {
  if (prop === undefined || (prop.type !== "text" && prop.type !== "date")) {
    return null;
  }
  const text = prop.value.trim();
  return text === "" ? null : text;
};

// `[[Steph Ango]]` and `[[people/steph|Steph Ango]]` read as the name they show
const WIKI_NAME = /^\[\[(?:[^|\]]*\|)?(?<name>[^\]]*)\]\]$/u;

const withoutWikiBrackets = (text: string): string =>
  (WIKI_NAME.exec(text.trim())?.groups?.name ?? text).trim();

const authorOf = (prop: TypedProperty | undefined): string | null => {
  if (prop?.type === "tags") {
    const names = prop.value.map(withoutWikiBrackets).filter((name) => name !== "");
    return names.length === 0 ? null : clip(names.join(", "), AUTHOR_MAX);
  }
  const text = textOf(prop);
  if (text === null) {
    return null;
  }
  const name = withoutWikiBrackets(text);
  return name === "" ? null : clip(name, AUTHOR_MAX);
};

// a date or a number is kept as written: `published` is whatever the page said
const publishedOf = (prop: TypedProperty | undefined): string | null => {
  if (prop?.type === "number") {
    return clip(String(prop.value), PUBLISHED_MAX);
  }
  const text = textOf(prop);
  return text === null ? null : clip(text, PUBLISHED_MAX);
};

const timeOf = (prop: TypedProperty | undefined): number | null => {
  const text = textOf(prop);
  return text === null ? null : parseItemTime(text);
};

const kindOf = (prop: TypedProperty | undefined): ItemKind => {
  const text = textOf(prop)?.toLowerCase() ?? "";
  return isItemKind(text) ? text : "note";
};

// what an item's frontmatter says; a block that does not parse, or none, is a plain note
export const readItemFacts = (parsed: ParsedProperties | null): ItemFacts => {
  if (parsed?.kind !== "valid") {
    return NOTE_FACTS;
  }
  const { properties } = parsed;
  const rawUrl = textOf(propertyOf(properties, "url"));
  const url = rawUrl !== null && isWebUrl(rawUrl) ? rawUrl : null;
  const site = textOf(propertyOf(properties, "site"));
  return {
    author: authorOf(propertyOf(properties, "author")),
    description: textOf(propertyOf(properties, "description")),
    fetchError: textOf(propertyOf(properties, "fetch-error")),
    fetchedMs: timeOf(propertyOf(properties, "fetched")),
    kind: kindOf(propertyOf(properties, "kind")),
    published: publishedOf(propertyOf(properties, "published")),
    savedMs: timeOf(propertyOf(properties, "saved")),
    site: site === null ? null : clip(site, SITE_MAX),
    url,
  };
};
