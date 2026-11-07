// What a markdown file's own text says about it outside the blocks: the target an md url names,
// which the editor resolves a link by and the import files one under, and the tags and aliases its
// frontmatter declares, which an item's fields and the import read. A frontmatter value is read as
// Obsidian writes it.

import { TAGS_KEY, yamlStringEntries } from "../markdown/frontmatter";
import type { ParsedProperties } from "../markdown/frontmatter";
import { safeDecode } from "../text/safe-decode";
import { isTagName } from "./tag-grammar";

// anything with a scheme (`https:`, `mailto:`, `C:\…` alike) or protocol-relative `//` is external
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

// the path an md url names, percent-decoded and its anchor left off; null for an external or
// same-note url
export const mdLinkTarget = (url: string): string | null => {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || SCHEME.test(url)) {
    return null;
  }
  const hash = url.indexOf("#");
  return safeDecode(hash === -1 ? url : url.slice(0, hash));
};

// A list or one bare string, as Obsidian accepts, a leading `#` left off; a value outside the tag
// grammar (`reading list`, a quoted `2026`) is no tag, since no inline `#` could address it.
export const frontmatterTags = (yaml: string): string[] =>
  yamlStringEntries(yaml, TAGS_KEY).flatMap((value) => {
    const tag = (value.startsWith("#") ? value.slice(1) : value).trim();
    return isTagName(tag) ? [tag] : [];
  });

// obsidian interop: a single-string scalar and the legacy `alias:` key are accepted too
export const frontmatterAliases = (parsed: ParsedProperties | null): string[] => {
  if (parsed?.kind !== "valid") {
    return [];
  }
  const prop =
    parsed.properties.find((p) => p.key === "aliases") ??
    parsed.properties.find((p) => p.key === "alias");
  if (!prop) {
    return [];
  }
  let values: readonly string[] = [];
  if (prop.type === "tags") {
    values = prop.value;
  } else if (prop.type === "text" || prop.type === "date") {
    // a date-shaped alias like `2026-07-01` classifies as date but is still a string
    values = [prop.value];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const alias = raw.trim();
    if (alias === "") {
      continue;
    }
    const key = alias.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(alias);
  }
  return out;
};
