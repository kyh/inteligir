// The owned unified parse. Plate's `deserializeMd` is banned in app code: it
// applies a regex `htmlToJsx` pre-pass that corrupts code fences, and it
// swallows parse errors into silently-degraded models. Here parse errors are
// REAL — the gate turns them into Raw mode.

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MD_REMARK_PLUGINS } from "./md-plugins";
import { escapePillPipesInTables } from "./table-pipes";

type ParseFailure = { message: string; line: number | null };

export type ParseResult = { ok: true; root: Root } | { ok: false; failure: ParseFailure };

// micromark/mdx errors are VFileMessage-shaped: `reason` is the human message,
// `line`/`place` carry the position. Fall back to Error.message for anything
// else that escapes the processor.
function toParseFailure(error: unknown): ParseFailure {
  let message = String(error);
  let line: number | null = null;
  if (error !== null && typeof error === "object") {
    if ("reason" in error && typeof error.reason === "string" && error.reason !== "") {
      message = error.reason;
    } else if ("message" in error && typeof error.message === "string") {
      message = error.message;
    }
    if ("line" in error && typeof error.line === "number") line = error.line;
  }
  return { line, message };
}

// unified types runSync's output as a bare Node when no transformer refined
// the processor's generics; a remark transform always yields the (same) root.
function isMdastRoot(node: { type: string }): node is Root {
  return node.type === "root";
}

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
    return { failure: toParseFailure(error), ok: false };
  }
}
