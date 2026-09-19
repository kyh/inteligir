// One json column rather than child tables: nothing queries the parts, resolution
// happens in memory. Parsing throws on any malformed row, which the store treats
// as corruption and wipe-rebuilds, so strictness costs a rebuild and never data.

import { z } from "zod";

import type { StoredLink, DocProjection } from "./projection";

const fail: (what: string) => never = (what) => {
  throw new Error(`knowledge-store: stored projection ${what}`);
};

const storedLinkRow = z.object({
  // absent and a stored `null` are the same fact
  alias: z.string().nullish(),
  anchor: z.string().nullish(),
  embed: z.boolean(),
  kind: z.enum(["wiki", "md", "image"]),
  line: z.number(),
  snippet: z.string(),
  target: z.string(),
  targetSpan: z.object({ end: z.number(), start: z.number() }).nullish(),
});

const storedProjectionRow = z.object({
  aliases: z.array(z.string()),
  headings: z.array(z.string()),
  links: z.array(storedLinkRow),
  noteId: z.string().nullable(),
  // not optional: a PROJECTION_VERSION mismatch wipes and rebuilds, so no stored row can lack a current field
  pinned: z.boolean(),
  tags: z.array(z.string()),
  tasks: z.array(z.object({ checked: z.boolean(), line: z.number(), text: z.string() })),
  title: z.string(),
});

// key by key, not spread: an absent optional must stay absent under exactOptionalPropertyTypes
const toStoredLink = (row: z.infer<typeof storedLinkRow>): StoredLink => {
  const link: StoredLink = {
    embed: row.embed,
    kind: row.kind,
    line: row.line,
    snippet: row.snippet,
    target: row.target,
  };
  if (row.anchor !== null && row.anchor !== undefined) {
    link.anchor = row.anchor;
  }
  if (row.alias !== null && row.alias !== undefined) {
    link.alias = row.alias;
  }
  if (row.targetSpan !== null && row.targetSpan !== undefined) {
    link.targetSpan = { end: row.targetSpan.end, start: row.targetSpan.start };
  }
  return link;
};

export const parseStoredProjection = (json: string): DocProjection => {
  let source: unknown;
  try {
    source = JSON.parse(json);
  } catch {
    fail("is not valid json");
  }
  const row = storedProjectionRow.safeParse(source);
  if (!row.success) {
    fail(z.prettifyError(row.error));
  }
  return {
    aliases: row.data.aliases,
    headings: row.data.headings,
    links: row.data.links.map(toStoredLink),
    noteId: row.data.noteId,
    pinned: row.data.pinned,
    tags: row.data.tags,
    tasks: row.data.tasks,
    title: row.data.title,
  };
};
