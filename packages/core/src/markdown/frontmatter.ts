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

import {
  isMap,
  isScalar,
  parse as parseYaml,
  parseDocument,
  stringify as stringifyYaml,
} from "yaml";

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

/** The raw yaml source inside a doc's leading frontmatter fences (no fences,
 * no trailing line terminator — the shape `parseProperties` expects), or
 * `null` when the doc has no frontmatter block. The one place besides
 * `splitFrontmatter` allowed to know the fence grammar, so consumers that need
 * the header's SOURCE (the sync merge ladder) never fork the regex. */
export function frontmatterYaml(text: string): string | null {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;
  return match[1] ?? "";
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

// ---------------------------------------------------------------------------
// Typed properties — the file-properties panel's parse/serialize contract
// (CLAUDE.md § Decisions: the markdown file is the ONLY property store).
// This sits ONE layer above splitFrontmatter: the panel already holds the
// frontmatter block's raw yaml (the Plate frontmatter node's `value`), so these
// helpers work on that yaml text directly. Kept here beside the split seam so
// there is a single core home for frontmatter/YAML knowledge — the broker's
// `read → properties` and the panel never fork a second YAML parser.
//
// Conservative typing (YAML 1.2 core schema, the `yaml` package's default):
// `true`/`false` are the ONLY booleans, so `yes/no/on/off` stay text; the core
// schema has no timestamp tag, so dates are recognized ONLY from explicit
// `YYYY-MM-DD` strings; anything the panel can't safely round-trip (nested
// maps, mixed/non-string arrays, nulls, anchors) is "unsupported" — displayed
// read-only and preserved byte-for-byte on save via the Document API.
// ---------------------------------------------------------------------------

export type PropertyType = "text" | "number" | "checkbox" | "date" | "tags" | "unsupported";

/** A frontmatter key parsed into a typed control. The ADT keeps illegal
 * states unrepresentable: each type carries exactly the value shape its field
 * edits, and `unsupported` carries the raw source bytes it must preserve. */
export type TypedProperty =
  | { key: string; type: "text"; value: string }
  | { key: string; type: "number"; value: number }
  | { key: string; type: "checkbox"; value: boolean }
  | { key: string; type: "date"; value: string }
  | { key: string; type: "tags"; value: string[] }
  | { key: string; type: "unsupported"; rawYaml: string };

/** The result of typing a frontmatter block:
 *  - `none`    — the block is empty (no properties to show).
 *  - `invalid` — malformed yaml, duplicate keys, or a non-mapping root. The
 *                panel shows "properties unavailable" and NEVER rewrites the
 *                block: what it can't read, it can't destroy.
 *  - `valid`   — a top-level mapping, each key classified. */
export type ParsedProperties =
  | { kind: "valid"; properties: TypedProperty[] }
  | { kind: "invalid" }
  | { kind: "none" };

// Explicit calendar-date shape only — no month/day range check, so an
// out-of-range `2026-13-40` still edits as a (plain-text) date field rather
// than being silently reclassified; the point is byte-safety, not validation.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function classify(key: string, value: unknown, rawYaml: string): TypedProperty {
  if (typeof value === "boolean") return { key, type: "checkbox", value };
  if (typeof value === "number" && Number.isFinite(value)) return { key, type: "number", value };
  if (typeof value === "string") {
    return DATE_RE.test(value) ? { key, type: "date", value } : { key, type: "text", value };
  }
  if (isStringArray(value)) return { key, type: "tags", value };
  return { key, type: "unsupported", rawYaml };
}

/** Type a frontmatter block's raw yaml into editable properties. Never throws:
 * a parse failure (or non-mapping root) is reported as `invalid`, leaving the
 * caller to preserve the raw block untouched. */
export function parseProperties(yamlText: string): ParsedProperties {
  if (yamlText.trim() === "") return { kind: "none" };
  let doc;
  try {
    doc = parseDocument(yamlText);
  } catch {
    return { kind: "invalid" };
  }
  // Duplicate keys and malformed yaml both surface as document errors.
  if (doc.errors.length > 0) return { kind: "invalid" };
  const contents = doc.contents;
  if (!isMap(contents)) return { kind: "invalid" };
  const properties: TypedProperty[] = [];
  for (const item of contents.items) {
    const keyNode = item.key;
    const key = isScalar(keyNode) ? String(keyNode.value) : String(keyNode);
    const valueNode = item.value;
    // Slice the value's source bytes for the unsupported read-only display;
    // range[0..1] is the value span (excludes the key and trailing node gap).
    const range = valueNode?.range;
    const rawYaml = range ? yamlText.slice(range[0], range[1]).trimEnd() : "";
    const value = valueNode == null ? null : valueNode.toJSON();
    properties.push(classify(key, value, rawYaml));
  }
  return { kind: "valid", properties };
}

/** A note's `private: true` verdict, read from its raw text. `indeterminate`
 * means frontmatter exists but can't be typed (malformed yaml, duplicate keys,
 * non-mapping root) — AI paths treat that as private (fail-closed: what we
 * can't read, we don't send to a model); user-facing UI treats it as
 * not-private (no lock badge for a yaml typo). */
export type NotePrivacy = "public" | "private" | "indeterminate";

/** The ONE `private` verdict kernel, over already-parsed frontmatter: an
 * empty block is public, an untypeable one is indeterminate, and only a
 * boolean `private: true` checkbox reads private (`yes`/`"true"` stay text
 * and read public, exactly like the properties panel shows them). Every
 * privacy read — notePrivacy here, the index's projection, the editor's
 * live probe — calls this; each caller keeps only its own substrate read and
 * its fail-open vs fail-closed mapping of `indeterminate`. */
export function privacyOfParsed(parsed: ParsedProperties): NotePrivacy {
  if (parsed.kind === "none") return "public";
  if (parsed.kind === "invalid") return "indeterminate";
  const prop = parsed.properties.find((p) => p.key === "private");
  return prop !== undefined && prop.type === "checkbox" && prop.value ? "private" : "public";
}

/** The `private`-flag toggle transform shared by the raw-text and editor-node
 * writers: ON replaces any existing `private` key with an appended
 * `private: true`; OFF removes the key (absent == public). */
export function withPrivateFlag(properties: TypedProperty[], on: boolean): TypedProperty[] {
  const rest = properties.filter((p) => p.key !== "private");
  return on ? [...rest, { key: "private", type: "checkbox", value: true }] : rest;
}

/** Classify a doc's privacy from its raw text — privacyOfParsed over the
 * leading frontmatter block. No frontmatter is public. */
export function notePrivacy(text: string): NotePrivacy {
  const yaml = frontmatterYaml(text);
  if (yaml === null) return "public";
  return privacyOfParsed(parseProperties(yaml));
}

/** Set/clear a doc's `private` flag at the TEXT level (the raw-mode path of
 * the palette toggle; rich mode edits the frontmatter node instead — both
 * flow through parseProperties/serializeProperties, one YAML brain). Turning
 * ON appends `private: true`; turning OFF removes the key (absent == public,
 * and an emptied block disappears entirely). Returns null when the existing
 * frontmatter can't be typed — what we can't read, we never rewrite. */
export function setNotePrivate(text: string, value: boolean): string | null {
  const yaml = frontmatterYaml(text);
  const parsed = parseProperties(yaml ?? "");
  if (parsed.kind === "invalid") return null;
  const next = withPrivateFlag(parsed.kind === "valid" ? parsed.properties : [], value);
  const nextYaml = serializeProperties(next, yaml ?? "");
  const body = splitFrontmatter(text).body;
  return nextYaml === "" ? body : `---\n${nextYaml}\n---\n${body}`;
}

/** Record `alias` in a doc's frontmatter `aliases:` — the byte-preserving
 * writer the rename pipeline uses so an old title keeps resolving. Runs over
 * the yaml Document API (serializeProperties), NOT splitFrontmatter +
 * serializeDoc, so untouched keys keep their exact source bytes, comments
 * included. Returns null (write NOTHING) when:
 *   - the frontmatter can't be typed (`invalid` — never rewrite what we
 *     can't read),
 *   - the alias list key exists but is not a plain string array,
 *   - the alias is already present case-insensitively.
 * The legacy `alias:` key is honored when it is the doc's only alias list
 * (extraction prefers `aliases`, so minting `aliases` beside an existing
 * `alias` would silently shadow the old entries). A doc with no frontmatter
 * gains a block; the body is preserved byte-exactly. */
export function addFrontmatterAlias(content: string, alias: string): string | null {
  const trimmed = alias.trim();
  if (trimmed === "") return null;
  const yaml = frontmatterYaml(content);
  const parsed = parseProperties(yaml ?? "");
  if (parsed.kind === "invalid") return null;
  const props = parsed.kind === "valid" ? parsed.properties : [];
  const key =
    props.some((p) => p.key === "aliases") || !props.some((p) => p.key === "alias")
      ? "aliases"
      : "alias";
  const existing = props.find((p) => p.key === key);
  if (existing !== undefined && existing.type !== "tags") return null;
  const current = existing === undefined ? [] : existing.value;
  if (current.some((a) => a.trim().toLowerCase() === trimmed.toLowerCase())) return null;
  const nextProps: TypedProperty[] =
    existing === undefined
      ? [...props, { key, type: "tags", value: [trimmed] }]
      : props.map(
          (p): TypedProperty =>
            p.key === key && p.type === "tags"
              ? { key: p.key, type: "tags", value: [...p.value, trimmed] }
              : p,
        );
  const nextYaml = serializeProperties(nextProps, yaml ?? "");
  const body = splitFrontmatter(content).body;
  return `---\n${nextYaml}\n---\n${body}`;
}

/** Type a single new key from a user-entered raw value (the panel's "Add
 * property" flow): the value is read as a YAML scalar so `true`, `42`,
 * `2026-07-01`, `[a, b]` type naturally, exactly as if it had been typed into
 * the block. An empty value is an empty text property. */
export function typeNewProperty(key: string, rawValue: string): TypedProperty {
  if (rawValue.trim() === "") return { key, type: "text", value: "" };
  let value: unknown;
  try {
    value = parseYaml(rawValue);
  } catch {
    value = rawValue;
  }
  return classify(key, value, rawValue);
}

function typedValue(prop: TypedProperty): unknown {
  return prop.type === "unsupported" ? undefined : prop.value;
}

/** Property-value equality as the panel (and the sync merge ladder) define it:
 * strict for scalars, element-wise for the flat string arrays `tags` carries. */
export function valueEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

/** Recombine typed properties back into a frontmatter block's raw yaml (no
 * fences, no trailing newline — matching remark-frontmatter's node `value`).
 * Works over the `yaml` Document parsed from `priorRaw` so untouched keys —
 * crucially every `unsupported` one — keep their exact source bytes, comments
 * included; key ORDER is preserved and new keys append. Only keys whose value
 * actually changed are re-set, so an edit to one property yields a minimal
 * diff. An empty property list clears the block entirely (returns ""). */
export function serializeProperties(properties: TypedProperty[], priorRaw: string): string {
  if (properties.length === 0) return "";
  const doc = parseDocument(priorRaw);
  let parsedPrior: unknown = null;
  try {
    if (priorRaw.trim() !== "") parsedPrior = parseYaml(priorRaw);
  } catch {
    parsedPrior = null;
  }
  const priorValues: Properties = isPlainRecord(parsedPrior) ? parsedPrior : {};
  if (isMap(doc.contents)) {
    const desired = new Set(properties.map((prop) => prop.key));
    const removable = doc.contents.items
      .map((item) => (isScalar(item.key) ? String(item.key.value) : String(item.key)))
      .filter((key) => !desired.has(key));
    for (const key of removable) doc.delete(key);
  }
  for (const prop of properties) {
    // Unsupported keys are never re-set — the Document keeps their raw bytes.
    if (prop.type === "unsupported") continue;
    const next = typedValue(prop);
    const had = Object.prototype.hasOwnProperty.call(priorValues, prop.key);
    if (!had || !valueEqual(priorValues[prop.key], next)) doc.set(prop.key, next);
  }
  // A mapping always stringifies with a single trailing newline; the frontmatter
  // node value carries none, so drop exactly one.
  return doc.toString().replace(/\n$/, "");
}
