// The owned unified parse. Plate's `deserializeMd` is banned in app code: it
// applies a regex `htmlToJsx` pre-pass that corrupts code fences, and it
// swallows parse errors into silently-degraded models. Here parse errors are
// REAL — the gate turns them into Raw mode.

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { z } from "zod";

import { isMdastRoot } from "./mdast-nodes";
import { MD_REMARK_PLUGINS } from "./md-plugins";
import { escapePillPipesInTables } from "./table-pipes";

type ParseFailure = { message: string; line: number | null };

export type ParseResult = { ok: true; root: Root } | { ok: false; failure: ParseFailure };

// What a thrown processor error carries. micromark/mdx errors are
// VFileMessage-shaped — `reason` is the human message, `line`/`place` carry the
// position — but anything at all can escape a transform, so every field is
// optional, a field that fails its own type reads as absent, and a non-object
// throw decodes to no fields rather than failing the decode.
const THROWN_PARSE_ERROR = z
  .object({
    reason: z.string().min(1).optional().catch(undefined),
    message: z.string().optional().catch(undefined),
    line: z.number().optional().catch(undefined),
  })
  .catch({});

export function parseMdast(md: string): ParseResult {
  const processor = unified().use(remarkParse).use(MD_REMARK_PLUGINS);
  try {
    // runSync is where the tree-shaping plugins act: the inline constructs, the
    // tabs containers and the opaque transform are all transformers, so a bare
    // `parse` yields a DIFFERENT tree (see markdown/verbatim-spans, which wants
    // exactly that one).
    //
    // Foreign bytes first: raw pill pipes in table cells become `\|`
    // (table-pipes.ts states why this lives ahead of micromark).
    const tree = processor.runSync(processor.parse(escapePillPipesInTables(md)));
    if (!isMdastRoot(tree)) throw new Error("markdown transform returned a non-root node");
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
}
