// ---------------------------------------------------------------------------
// Frontmatter split / recombine — the pure body↔properties seam the HTML-app
// broker uses to expose vault docs as `{ body, properties }` and patch them
// back. This is deliberately NOT the editor's Plate round-trip (which keeps
// frontmatter as an opaque yaml string, read-only in Rich): the broker needs a
// parsed key/value mapping so an app can add/replace/delete individual
// properties. It touches only the leading `---` fenced block and preserves the
// body verbatim — no markdown reparse, no byte surgery on the body.
//
// Platform-neutral (pure `yaml`, no node/dom), so it runs in the renderer,
// worker, or RN like the rest of @repo/core.
// ---------------------------------------------------------------------------

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** A doc's frontmatter as a parsed top-level mapping. */
export type Properties = Record<string, unknown>;

/** A property patch: a value replaces (or adds) that key; `null` DELETES it;
 * omitted keys are preserved. Mirrors the broker's `update` semantics. */
export type PropertiesPatch = Record<string, unknown>;

export type SplitDoc = {
  /** Parsed frontmatter mapping. `{}` when there is no frontmatter (or it was
   * empty / not a mapping — a non-mapping frontmatter is rare and treated as
   * absent rather than guessed at). */
  properties: Properties;
  /** Everything after the frontmatter block, byte-for-byte. */
  body: string;
  /** Whether the source opened with a `---` frontmatter fence. */
  hadFrontmatter: boolean;
};

// A leading YAML frontmatter block: `---` on its own line, the yaml, then a
// closing `---` line. Matches remark-frontmatter's default (`yaml`). The
// content line(s) are optional so an empty block (`---\n---\n`) still matches.
// The body begins immediately after the closing fence's line terminator.
const FRONTMATTER_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

function isPlainRecord(value: unknown): value is Properties {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Split raw doc text into `{ properties, body }`. Never throws on malformed
 * yaml — a block that doesn't parse to a mapping yields empty properties with
 * `hadFrontmatter: true` so the caller can decide, and the body is always the
 * exact remainder. */
export function splitFrontmatter(text: string): SplitDoc {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { properties: {}, body: text, hadFrontmatter: false };
  const body = text.slice(match[0].length);
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch {
    parsed = null;
  }
  return { properties: isPlainRecord(parsed) ? parsed : {}, body, hadFrontmatter: true };
}

/** Recombine a properties mapping + body into doc text. An empty mapping emits
 * NO frontmatter block (so clearing every property removes the fence). */
export function serializeDoc(properties: Properties, body: string): string {
  if (Object.keys(properties).length === 0) return body;
  // stringifyYaml always ends the mapping with a newline, so the closing fence
  // sits on its own line.
  return `---\n${stringifyYaml(properties)}---\n${body}`;
}

/** Apply a property patch: provided keys replace/add, `null` deletes, omitted
 * keys are preserved. Pure — returns a new mapping. */
export function applyPropertiesPatch(current: Properties, patch: PropertiesPatch): Properties {
  const next: Properties = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
