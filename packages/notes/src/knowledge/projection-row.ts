// One json column rather than child tables: nothing queries the parts, resolution
// happens in memory. Parsing throws on any malformed row, which the store treats
// as corruption and wipe-rebuilds, so strictness costs a rebuild and never data.

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
  // absent and a stored `null` are the same fact
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
  tasks: z.array(z.object({ checked: z.boolean(), text: z.string(), line: z.number() })),
  // not optional: a PROJECTION_VERSION mismatch wipes and rebuilds, so no stored row can lack a current field
  pinned: z.boolean(),
  noteId: z.string().nullable(),
});

// key by key, not spread: an absent optional must stay absent under exactOptionalPropertyTypes
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
