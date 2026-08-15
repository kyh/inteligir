// ---------------------------------------------------------------------------
// A DocProjection across the SQL boundary, as ONE json column.
//
// The projection is stored whole rather than shredded into child tables,
// because nothing queries its parts: link, tag and name RESOLUTION all happen
// in the in-memory LinkGraphIndex, so child rows would be read only by
// hydration's own sweeps — a value object spelled as a relational schema.
//
// It is also the cost the store is shaped around: Durable Object SQLite bills
// rows WRITTEN, so one doc with 30 links, 12 headings, 5 tags and 8 tasks is
// one billed write here and 56 shredded.
//
// Parsing is TOTAL and THROWS: the store's guards treat any malformed row as
// corruption and wipe-rebuild, which is safe precisely because nothing durable
// lives in the index tables. So a validator that is too strict costs a rebuild,
// never data — which is why it checks every field rather than trusting the
// build that wrote them.
// ---------------------------------------------------------------------------

import type { StoredLink } from "./projection";
import type { DocProjection } from "./projection";
import type { ExtractedTask } from "./task-ordinal";

function fail(what: string): never {
  throw new Error(`knowledge-store: stored projection ${what}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(what);
  return value;
}

function str(source: Record<string, unknown>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== "string") fail(`${what}.${key} is not text`);
  return value;
}

function num(source: Record<string, unknown>, key: string, what: string): number {
  const value = source[key];
  if (typeof value !== "number") fail(`${what}.${key} is not a number`);
  return value;
}

function bool(source: Record<string, unknown>, key: string, what: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") fail(`${what}.${key} is not a boolean`);
  return value;
}

function strings(source: Record<string, unknown>, key: string, what: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) fail(`${what}.${key} is not an array`);
  return value.map((entry, i) => {
    if (typeof entry !== "string") fail(`${what}.${key}[${i}] is not text`);
    return entry;
  });
}

function array(source: Record<string, unknown>, key: string, what: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) fail(`${what}.${key} is not an array`);
  return value;
}

/** Optional string: absent and null both mean "not written". */
function optionalStr(source: Record<string, unknown>, key: string, what: string): string | null {
  const value = source[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(`${what}.${key} is not text`);
  return value;
}

function parseLink(value: unknown, i: number): StoredLink {
  const what = `links[${i}]`;
  const row = record(value, `${what} is not an object`);
  const kind = str(row, "kind", what);
  if (kind !== "wiki" && kind !== "md" && kind !== "image") fail(`${what}.kind is ${kind}`);
  const link: StoredLink = {
    kind,
    embed: bool(row, "embed", what),
    target: str(row, "target", what),
    line: num(row, "line", what),
    snippet: str(row, "snippet", what),
  };
  // Rebuilt key by key rather than spread: an optional that was absent must
  // stay absent under exactOptionalPropertyTypes, and a stored `null` is the
  // same fact as an omitted key.
  const anchor = optionalStr(row, "anchor", what);
  if (anchor !== null) link.anchor = anchor;
  const alias = optionalStr(row, "alias", what);
  if (alias !== null) link.alias = alias;
  const span = row["targetSpan"];
  if (span !== undefined && span !== null) {
    const spanRow = record(span, `${what}.targetSpan is not an object`);
    link.targetSpan = {
      start: num(spanRow, "start", `${what}.targetSpan`),
      end: num(spanRow, "end", `${what}.targetSpan`),
    };
  }
  return link;
}

function parseTask(value: unknown, i: number): ExtractedTask {
  const what = `tasks[${i}]`;
  const row = record(value, `${what} is not an object`);
  return {
    checked: bool(row, "checked", what),
    text: str(row, "text", what),
    raw: str(row, "raw", what),
    line: num(row, "line", what),
    ordinal: num(row, "ordinal", what),
    wikiTargets: strings(row, "wikiTargets", what),
  };
}

/** The json column, parsed back into the value object the index rebuilds from. */
export function parseStoredProjection(json: string): DocProjection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("is not valid json");
  }
  const row = record(parsed, "is not an object");
  return {
    title: str(row, "title", "projection"),
    headings: strings(row, "headings", "projection"),
    links: array(row, "links", "projection").map(parseLink),
    tags: strings(row, "tags", "projection"),
    aliases: strings(row, "aliases", "projection"),
    tasks: array(row, "tasks", "projection").map(parseTask),
  };
}
