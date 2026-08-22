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

import { z } from "zod";

import type { StoredLink } from "./projection";
import type { DocProjection } from "./projection";

function fail(what: string): never {
  throw new Error(`knowledge-store: stored projection ${what}`);
}

const storedLinkRow = z.object({
  kind: z.enum(["wiki", "md", "image"]),
  embed: z.boolean(),
  target: z.string(),
  line: z.number(),
  snippet: z.string(),
  // Optionals: absent and a stored `null` are the same fact ("not written").
  anchor: z.string().nullish(),
  alias: z.string().nullish(),
  targetSpan: z.object({ start: z.number(), end: z.number() }).nullish(),
});

const storedProjectionRow = z.object({
  title: z.string(),
  headings: z.array(z.string()),
  links: z.array(storedLinkRow),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  tasks: z.array(
    z.object({
      checked: z.boolean(),
      text: z.string(),
      raw: z.string(),
      line: z.number(),
      ordinal: z.number(),
    }),
  ),
  // Strict, not optional: a PROJECTION_VERSION mismatch wipes and rebuilds,
  // so no stored row can legitimately lack a current field.
  pinned: z.boolean(),
  noteId: z.string().nullable(),
});

// Rebuilt key by key rather than spread: an optional that was absent must
// stay absent under exactOptionalPropertyTypes, and a stored `null` is the
// same fact as an omitted key.
function toStoredLink(row: z.infer<typeof storedLinkRow>): StoredLink {
  const link: StoredLink = {
    kind: row.kind,
    embed: row.embed,
    target: row.target,
    line: row.line,
    snippet: row.snippet,
  };
  if (row.anchor != null) link.anchor = row.anchor;
  if (row.alias != null) link.alias = row.alias;
  if (row.targetSpan != null) {
    link.targetSpan = { start: row.targetSpan.start, end: row.targetSpan.end };
  }
  return link;
}

/** The json column, parsed back into the value object the index rebuilds from. */
export function parseStoredProjection(json: string): DocProjection {
  const source = z
    .string()
    .transform((text, ctx): z.infer<ReturnType<typeof z.json>> => {
      try {
        return JSON.parse(text);
      } catch {
        ctx.addIssue("is not valid json");
        return z.NEVER;
      }
    })
    .safeParse(json);
  if (!source.success) fail("is not valid json");
  const row = storedProjectionRow.safeParse(source.data);
  if (!row.success) fail(z.prettifyError(row.error));
  return {
    title: row.data.title,
    headings: row.data.headings,
    links: row.data.links.map(toStoredLink),
    tags: row.data.tags,
    aliases: row.data.aliases,
    tasks: row.data.tasks,
    pinned: row.data.pinned,
    noteId: row.data.noteId,
  };
}
