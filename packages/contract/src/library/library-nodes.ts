import { z } from "zod";

import { isIsoDate } from "../iso-date";
import { canonicalJson, utf8ByteLength } from "./canonical-json";
import { shaSchema } from "./library-item";

const LIBRARY_SECTIONS = ["note", "article"] as const;
export const librarySectionSchema = z.enum(LIBRARY_SECTIONS);

export type LibrarySection = z.infer<typeof librarySectionSchema>;

const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const blockIdSchema = z.string().regex(BLOCK_ID_RE);

export const BLOCK_MAX_BYTES = 512 * 1024;

export const BLOCK_MAX_DEPTH = 32;

export const LIST_MAX_INDENT = 128;

const mark = z.literal(true).optional();

export const libraryTextSchema = z.strictObject({
  bold: mark,
  code: mark,
  italic: mark,
  strikethrough: mark,
  text: z.string(),
  underline: mark,
});

const voidChildren = z.tuple([libraryTextSchema.extend({ text: z.literal("") })]);

const listIndent = z.number().int().min(1).max(LIST_MAX_INDENT).optional();
const listNumber = z.number().int().nonnegative().optional();

const listProps = {
  checked: z.boolean().optional(),
  indent: listIndent,
  listRestart: listNumber,
  listRestartPolite: listNumber,
  listStart: listNumber,
  listStyleType: z.enum(["disc", "decimal", "todo"]).optional(),
};

export const ALERT_VARIANTS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
export const alertVariantSchema = z.enum(ALERT_VARIANTS);

export type AlertVariant = z.infer<typeof alertVariantSchema>;

const isoDate = z.string().refine(isIsoDate, { error: "is not a calendar day" });

const oneSource = (value: { sha?: string | undefined; url?: string | undefined }) =>
  (value.sha === undefined) !== (value.url === undefined);

const ONE_SOURCE = { error: "names its bytes by sha or its address by url, exactly one" };

const paragraph = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("p"),
  })
  .extend(listProps);

const heading1 = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("h1"),
  })
  .extend(listProps);

const heading2 = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("h2"),
  })
  .extend(listProps);

const heading3 = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("h3"),
  })
  .extend(listProps);

const heading4 = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("h4"),
  })
  .extend(listProps);

const heading5 = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("h5"),
  })
  .extend(listProps);

const heading6 = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("h6"),
  })
  .extend(listProps);

const blockquote = z
  .strictObject({
    alert: alertVariantSchema.optional(),
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("blockquote"),
  })
  .extend(listProps);

const toggle = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    type: z.literal("toggle"),
  })
  .extend(listProps);

const codeBlock = z
  .strictObject({
    get children() {
      return z.array(libraryNodeSchema);
    },
    lang: z.string().optional(),
    type: z.literal("code_block"),
  })
  .extend(listProps);

const codeLine = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  type: z.literal("code_line"),
});

const table = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  indent: listIndent,
  type: z.literal("table"),
});

const tableRow = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  type: z.literal("tr"),
});

const tableCell = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  type: z.literal("td"),
});

const tableHeader = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  type: z.literal("th"),
});

const columnGroup = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  indent: listIndent,
  type: z.literal("column_group"),
});

const column = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  type: z.literal("column"),
  width: z
    .string()
    .regex(/^\d+(?:\.\d+)?%$/u)
    .optional(),
});

const tabGroup = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  indent: listIndent,
  type: z.literal("tab_group"),
});

const tabPanel = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  label: z.string(),
  type: z.literal("tab_panel"),
});

const link = z.strictObject({
  get children() {
    return z.array(libraryNodeSchema);
  },
  type: z.literal("a"),
  url: z.string().min(1),
});

const rule = z.strictObject({ children: voidChildren, indent: listIndent, type: z.literal("hr") });

const equation = z.strictObject({
  children: voidChildren,
  indent: listIndent,
  texExpression: z.string(),
  type: z.literal("equation"),
});

const imageProps = z.strictObject({
  caption: z.array(libraryTextSchema).optional(),
  children: voidChildren,
  indent: listIndent,
  sha: shaSchema.optional(),
  title: z.string().optional(),
  type: z.literal("img"),
  url: z.string().min(1).optional(),
  width: z.number().positive().optional(),
});

const fileProps = z.strictObject({
  children: voidChildren,
  indent: listIndent,
  name: z.string().min(1).optional(),
  sha: shaSchema.optional(),
  type: z.literal("file"),
  url: z.string().min(1).optional(),
});

const videoProps = z.strictObject({
  children: voidChildren,
  indent: listIndent,
  sha: shaSchema.optional(),
  type: z.literal("video"),
  url: z.string().min(1).optional(),
});

const mediaEmbed = z.strictObject({
  children: voidChildren,
  indent: listIndent,
  type: z.literal("media_embed"),
  url: z.string().min(1),
});

const chartBlock = z.strictObject({
  children: voidChildren,
  indent: listIndent,
  type: z.literal("chart_block"),
  value: z.string(),
});

const canvasBlock = z.strictObject({
  children: voidChildren,
  indent: listIndent,
  type: z.literal("canvas_block"),
  value: z.string(),
});

const htmlBlock = z.strictObject({
  children: voidChildren,
  indent: listIndent,
  type: z.literal("html_block"),
  value: z.string(),
});

const mention = z.strictObject({
  children: voidChildren,
  key: z.string().min(1),
  type: z.literal("mention"),
  value: z.string(),
});

const date = z.strictObject({ children: voidChildren, date: isoDate, type: z.literal("date") });

const formulaPill = z.strictObject({
  children: voidChildren,
  display: z.string(),
  name: z.string().min(1).optional(),
  source: z.string().min(1),
  type: z.literal("formulaPill"),
});

const inlineEquation = z.strictObject({
  children: voidChildren,
  texExpression: z.string(),
  type: z.literal("inline_equation"),
});

const libraryElementSchema = z.discriminatedUnion("type", [
  paragraph,
  heading1,
  heading2,
  heading3,
  heading4,
  heading5,
  heading6,
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
  mention,
  date,
  formulaPill,
  inlineEquation,
]);

export type LibraryElement = z.infer<typeof libraryElementSchema>;

export const libraryNodeSchema: z.ZodUnion<
  [typeof libraryTextSchema, typeof libraryElementSchema]
> = z.union([libraryTextSchema, libraryElementSchema]);

export type LibraryNode = z.infer<typeof libraryNodeSchema>;

export const collectFileShas = (node: LibraryNode, into: Set<string>) => {
  if (!("children" in node)) {
    return;
  }

  if ("sha" in node && node.sha !== undefined) {
    into.add(node.sha);
  }

  for (const child of node.children) {
    collectFileShas(child, into);
  }
};

const topLevelId = { id: blockIdSchema };

export const libraryBlockSchema = z.discriminatedUnion("type", [
  paragraph.extend(topLevelId),
  heading1.extend(topLevelId),
  heading2.extend(topLevelId),
  heading3.extend(topLevelId),
  heading4.extend(topLevelId),
  heading5.extend(topLevelId),
  heading6.extend(topLevelId),
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

const nodeLevelSchema = z.looseObject({ children: z.array(z.unknown()).optional() });

export const storableBlockSchema = z
  .unknown()
  .refine(
    (value) => {
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
