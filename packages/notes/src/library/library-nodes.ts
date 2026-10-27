// The persisted node set: what an item's body may hold, checked at the library cell's boundary on
// every write. A body is a Plate Value stored one top-level block per row, so this is the Plate
// vocabulary the editor speaks, spelled once here because @repo/notes is the leaf every host
// reaches (the cell, both replicas and the editor above it) and the editor's own kits are not.
// Every element is a strict object: a prop the vocabulary does not name is refused, never
// carried, so a block a later reader cannot draw never lands.

import { z } from "zod";

import { ISO_DATE_PATTERN } from "../iso-date";
import { isTagName } from "../knowledge/tag-grammar";
import { canonicalJson, utf8ByteLength } from "./canonical-json";
import { SHA256_HEX_RE } from "./library-item";

// what part of an item a block belongs to: the person's writing, or the page a fill read
export const LIBRARY_SECTIONS = ["note", "article"] as const;
export const librarySectionSchema = z.enum(LIBRARY_SECTIONS);
export type LibrarySection = z.infer<typeof librarySectionSchema>;

// the editor mints a block's id (Plate's nodeId); a newline in one would break the order merge's
// one-line-per-block reading, and the grammar keeps it a short url-safe token
export const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;
export const blockIdSchema = z.string().regex(BLOCK_ID_RE);

// a Durable Object row holds 2 MB; a block holds a quarter of that, so its text column and its
// JSON fit one row together
export const BLOCK_MAX_BYTES = 512 * 1024;

// how deep a block nests: a table in a column in a tab panel is under ten, and a parse of
// untrusted JSON must not recurse until the stack runs out
export const BLOCK_MAX_DEPTH = 32;

const mark = z.literal(true).optional();

export const libraryTextSchema = z.strictObject({
  bold: mark,
  code: mark,
  italic: mark,
  strikethrough: mark,
  text: z.string(),
  underline: mark,
});

// a void element's one leaf: empty, and marked only when a mark was laid across it
const voidChildren = z.tuple([libraryTextSchema.extend({ text: z.literal("") })]);

// Plate's nodeId names nested blocks too; only a top-level block's id is required
const nestedId = blockIdSchema.optional();

// the indent list's props, which every indentable block may carry (`kits/headless/list-base.ts`),
// spelled into each object below: a spread beside a recursive getter defeats TypeScript's inference
const listChecked = z.boolean().optional();
const listIndent = z.number().int().min(1).optional();
const listStart = z.number().int().min(1).optional();
const listStyleType = z.enum(["disc", "decimal", "todo"]).optional();

const ANNOTATION_IDS_RE = /^[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*$/u;
const isoDate = z.string().regex(new RegExp(`^${ISO_DATE_PATTERN}$`, "u"));
const sha256Hex = z.string().regex(SHA256_HEX_RE);

// a file the library holds by its bytes, or a web resource by its address: exactly one
const oneSource = (value: { sha?: string | undefined; url?: string | undefined }): boolean =>
  (value.sha === undefined) !== (value.url === undefined);
const ONE_SOURCE = { error: "names its bytes by sha or its address by url, exactly one" };

// Zod's recursive objects (https://zod.dev/api#recursive-objects): a `children` getter names the
// node union, read only when a parse first reaches it, after the union below exists. Each
// recursive element is written out rather than made by a helper, since TypeScript cannot infer a
// function's return type through the recursion.
/* oxlint-disable no-use-before-define -- each getter runs only once libraryNodeSchema exists */
const paragraph = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("p"),
  checked: listChecked,
  indent: listIndent,
  listStart,
  listStyleType,
});
const heading1 = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("h1"),
  checked: listChecked,
  indent: listIndent,
  listStart,
  listStyleType,
});
const heading2 = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("h2"),
  checked: listChecked,
  indent: listIndent,
  listStart,
  listStyleType,
});
const heading3 = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("h3"),
  checked: listChecked,
  indent: listIndent,
  listStart,
  listStyleType,
});
const blockquote = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("blockquote"),
  checked: listChecked,
  indent: listIndent,
  listStart,
  listStyleType,
});
const toggle = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("toggle"),
  checked: listChecked,
  indent: listIndent,
  listStart,
  listStyleType,
});
const codeBlock = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  lang: z.string().optional(),
  type: z.literal("code_block"),
  checked: listChecked,
  indent: listIndent,
  listStart,
  listStyleType,
});
const codeLine = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("code_line"),
});
const table = z.strictObject({
  align: z.array(z.enum(["left", "center", "right"]).nullable()).optional(),
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("table"),
});
const tableRow = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("tr"),
});
const tableCell = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("td"),
});
const tableHeader = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("th"),
});
const columnGroup = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("column_group"),
});
const column = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("column"),
  width: z
    .string()
    .regex(/^\d+(?:\.\d+)?%$/u)
    .optional(),
});
const tabGroup = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  type: z.literal("tab_group"),
});
const tabPanel = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  id: nestedId,
  label: z.string(),
  type: z.literal("tab_panel"),
});
const link = z.strictObject({
  get children(): z.ZodArray<typeof libraryNodeSchema> {
    return z.array(libraryNodeSchema);
  },
  type: z.literal("a"),
  url: z.string().min(1),
});
/* oxlint-enable no-use-before-define */

const rule = z.strictObject({ children: voidChildren, id: nestedId, type: z.literal("hr") });

const equation = z.strictObject({
  children: voidChildren,
  id: nestedId,
  texExpression: z.string(),
  type: z.literal("equation"),
});

// the media elements before their one-source check, so a top-level variant can add its id first
const imageProps = z.strictObject({
  caption: z.array(libraryTextSchema).optional(),
  children: voidChildren,
  id: nestedId,
  sha: sha256Hex.optional(),
  type: z.literal("img"),
  url: z.string().min(1).optional(),
  width: z.number().positive().optional(),
});
const fileProps = z.strictObject({
  children: voidChildren,
  id: nestedId,
  name: z.string().min(1).optional(),
  sha: sha256Hex.optional(),
  type: z.literal("file"),
  url: z.string().min(1).optional(),
});
const videoProps = z.strictObject({
  children: voidChildren,
  id: nestedId,
  sha: sha256Hex.optional(),
  type: z.literal("video"),
  url: z.string().min(1).optional(),
});

const mediaEmbed = z.strictObject({
  children: voidChildren,
  id: nestedId,
  type: z.literal("media_embed"),
  url: z.string().min(1),
});

// the rich blocks keep their source as one string: a chart's JSON, a canvas's grid, an html page
const chartBlock = z.strictObject({
  children: voidChildren,
  id: nestedId,
  type: z.literal("chart_block"),
  value: z.string(),
});
const canvasBlock = z.strictObject({
  children: voidChildren,
  id: nestedId,
  type: z.literal("canvas_block"),
  value: z.string(),
});
const htmlBlock = z.strictObject({
  children: voidChildren,
  id: nestedId,
  type: z.literal("html_block"),
  value: z.string(),
});

// a link by the target's id, so a rename rewrites nothing: the title is what the writer saw, and
// a null id is a link to a title no item holds yet, which resolves when one appears
const wikiLink = z.strictObject({
  alias: z.string().min(1).optional(),
  blockRef: blockIdSchema.optional(),
  children: voidChildren,
  heading: z.string().min(1).optional(),
  itemId: z.string().min(1).nullable(),
  title: z.string().min(1),
  type: z.literal("wikiLink"),
});

const wikiEmbed = z.strictObject({
  blockRef: blockIdSchema.optional(),
  children: voidChildren,
  itemId: z.string().min(1),
  type: z.literal("wikiEmbed"),
});

const tag = z.strictObject({
  children: voidChildren,
  type: z.literal("tag"),
  value: z.string().refine(isTagName, { error: "is not a tag name" }),
});

const date = z.strictObject({ children: voidChildren, date: isoDate, type: z.literal("date") });

// `meta` keeps the dialect's `id=…;name=…` (`@repo/notes/formulas/formula-meta`), which names a
// formula another one reads
const formulaPill = z.strictObject({
  children: voidChildren,
  display: z.string(),
  meta: z.string().min(1).optional(),
  source: z.string(),
  type: z.literal("formulaPill"),
});

const inlineEquation = z.strictObject({
  children: voidChildren,
  texExpression: z.string(),
  type: z.literal("inline_equation"),
});

// what the dialect reads but no node models (an html comment, Obsidian's `%%x%%`), kept as source
const opaque = z.strictObject({
  children: voidChildren,
  source: z.string(),
  type: z.literal("opaque"),
});

// one edge of a highlight's passage; one marker can open or close several highlights at once
const annotationMarker = z.strictObject({
  children: voidChildren,
  edge: z.enum(["start", "end"]),
  ids: z.string().regex(ANNOTATION_IDS_RE),
  type: z.literal("annotationMarker"),
});

const libraryElementSchema = z.discriminatedUnion("type", [
  paragraph,
  heading1,
  heading2,
  heading3,
  blockquote,
  toggle,
  codeBlock,
  rule,
  table,
  columnGroup,
  tabGroup,
  equation,
  imageProps.refine(oneSource, ONE_SOURCE),
  fileProps.refine(oneSource, ONE_SOURCE),
  videoProps.refine(oneSource, ONE_SOURCE),
  mediaEmbed,
  chartBlock,
  canvasBlock,
  htmlBlock,
  codeLine,
  tableRow,
  tableCell,
  tableHeader,
  column,
  tabPanel,
  link,
  wikiLink,
  wikiEmbed,
  tag,
  date,
  formulaPill,
  inlineEquation,
  opaque,
  annotationMarker,
]);
export type LibraryElement = z.infer<typeof libraryElementSchema>;

export const libraryNodeSchema: z.ZodUnion<
  [typeof libraryTextSchema, typeof libraryElementSchema]
> = z.union([libraryTextSchema, libraryElementSchema]);
export type LibraryNode = z.infer<typeof libraryNodeSchema>;

const topLevelId = { id: blockIdSchema };

// a top-level block: one of the block types, and always named, since its id is its row's key
export const libraryBlockSchema = z.discriminatedUnion("type", [
  paragraph.extend(topLevelId),
  heading1.extend(topLevelId),
  heading2.extend(topLevelId),
  heading3.extend(topLevelId),
  blockquote.extend(topLevelId),
  toggle.extend(topLevelId),
  codeBlock.extend(topLevelId),
  rule.extend(topLevelId),
  table.extend(topLevelId),
  columnGroup.extend(topLevelId),
  tabGroup.extend(topLevelId),
  equation.extend(topLevelId),
  imageProps.extend(topLevelId).refine(oneSource, ONE_SOURCE),
  fileProps.extend(topLevelId).refine(oneSource, ONE_SOURCE),
  videoProps.extend(topLevelId).refine(oneSource, ONE_SOURCE),
  mediaEmbed.extend(topLevelId),
  chartBlock.extend(topLevelId),
  canvasBlock.extend(topLevelId),
  htmlBlock.extend(topLevelId),
]);
export type LibraryBlock = z.infer<typeof libraryBlockSchema>;

// one level of any node: only its children are read, so a level parses in constant time
const nodeLevelSchema = z.looseObject({ children: z.array(z.unknown()).optional() });

// a block as a write may land it: no deeper than BLOCK_MAX_DEPTH, checked before the recursive
// parse runs, then the vocabulary, then no larger than BLOCK_MAX_BYTES as canonical JSON
export const storableBlockSchema = z
  .unknown()
  .refine(
    (value) => {
      // walked without recursion, so the input a deep parse would overflow on cannot overflow this
      const pending = [{ depth: 1, node: value }];
      for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        if (next.depth > BLOCK_MAX_DEPTH) {
          return false;
        }
        const level = nodeLevelSchema.safeParse(next.node);
        for (const child of level.data?.children ?? []) {
          pending.push({ depth: next.depth + 1, node: child });
        }
      }
      return true;
    },
    { error: `nests deeper than ${String(BLOCK_MAX_DEPTH)} levels` },
  )
  .pipe(libraryBlockSchema)
  .refine((block) => utf8ByteLength(canonicalJson(block)) <= BLOCK_MAX_BYTES, {
    error: `is larger than ${String(BLOCK_MAX_BYTES)} bytes`,
  });
