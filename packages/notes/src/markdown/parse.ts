// not Plate's `deserializeMd`: its regex `htmlToJsx` pre-pass corrupts code fences and it
// swallows parse errors into silently-degraded models.

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { z } from "zod";

import { isMdastRoot } from "./mdast-nodes";
import { MD_REMARK_PLUGINS } from "./md-plugins";
import { escapePillPipesInTables } from "./table-pipes";

interface ParseFailure {
  message: string;
  line: number | null;
}

export type ParseResult = { ok: true; root: Root } | { ok: false; failure: ParseFailure };

// micromark/mdx errors are VFileMessage-shaped, but anything can escape a transform, so every
// field is optional and a non-object throw decodes to no fields.
// oxlint-disable promise/prefer-await-to-then -- `catch` here is zod's fallback for a failed parse, not a promise's
const THROWN_PARSE_ERROR = z
  .object({
    // oxlint-disable-next-line unicorn/no-useless-undefined -- zod's catch takes the fallback; a bare catch() is a type error
    line: z.number().optional().catch(undefined),
    // oxlint-disable-next-line unicorn/no-useless-undefined -- zod's catch takes the fallback; a bare catch() is a type error
    message: z.string().optional().catch(undefined),
    // oxlint-disable-next-line unicorn/no-useless-undefined -- zod's catch takes the fallback; a bare catch() is a type error
    reason: z.string().min(1).optional().catch(undefined),
  })
  .catch({});
// oxlint-enable promise/prefer-await-to-then

export const parseMdast = (md: string): ParseResult => {
  const processor = unified().use(remarkParse).use(MD_REMARK_PLUGINS);
  try {
    // runSync is where the transformer plugins act, so a bare `parse` yields a different tree
    // (verbatim-spans wants that one). pill pipes in table cells are escaped ahead of micromark.
    const tree = processor.runSync(processor.parse(escapePillPipesInTables(md)));
    if (!isMdastRoot(tree)) {
      throw new Error("markdown transform returned a non-root node");
    }
    return { ok: true, root: tree };
  } catch (error) {
    const reported = THROWN_PARSE_ERROR.parse(error);
    return {
      failure: {
        line: reported.line ?? null,
        message: reported.reason ?? reported.message ?? String(error),
      },
      ok: false,
    };
  }
};
