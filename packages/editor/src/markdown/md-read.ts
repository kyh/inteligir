// The one read of markdown into blocks: Plate's own deserialize over the dialect's plugins and
// rules, with no MDX pre-pass, and a failure said as a refusal rather than a degraded model.

import type { Nodes } from "mdast";
import { ElementApi, NodeApi } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import type { Plugin, Transformer } from "unified";
import { MarkdownPlugin } from "@platejs/markdown";

import { BLOCK_MAX_DEPTH, LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";
import { MD_REMARK_PLUGINS } from "@repo/editor/markdown/md-plugins";
import { remarkWikiImport } from "@repo/editor/markdown/remark-wiki-import";
import type { WikiResolve } from "@repo/editor/markdown/remark-wiki-import";
import { numberProp } from "@repo/editor/node-props";

import { isMdastRoot } from "./mdast-nodes";

type MarkdownRefusal = { kind: "too-deep" } | { kind: "failed"; error: Error };

export type MarkdownRead = { ok: true; value: TElement[] } | { ok: false; reason: MarkdownRefusal };

// V8 says a stack ran out as a RangeError, or as this SyntaxError when it ran out compiling a
// regular expression; anything else is a real failure
const isStackOverflow = (error: Error): boolean =>
  error instanceof RangeError ||
  (error instanceof SyntaxError && error.message.endsWith(": Stack overflow"));

// the deepest a storable item reads as: a list two levels a step to its deepest indent, inside
// blocks and their marks nested as deep as a block may
const READ_MAX_DEPTH = 2 * (LIST_MAX_INDENT + 1) + 2 * BLOCK_MAX_DEPTH;

class TooDeepError extends Error {
  override name = "TooDeepError";
}

// Measured before Plate builds nodes, whose recursion costs more than linear in depth and runs out
// of stack where each platform's frames put it, so a refusal is cheap and the same everywhere. Walked
// without recursion, so the tree a recursion overflows on cannot overflow this.
const remarkReadDepth: Plugin = function remarkReadDepth(): Transformer {
  return (tree) => {
    const pending: { depth: number; node: Nodes }[] = isMdastRoot(tree)
      ? [{ depth: 0, node: tree }]
      : [];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next.depth > READ_MAX_DEPTH) {
        throw new TooDeepError(`nests deeper than ${String(READ_MAX_DEPTH)} levels`);
      }
      if ("children" in next.node) {
        for (const child of next.node.children) {
          pending.push({ depth: next.depth + 1, node: child });
        }
      }
    }
  };
};

const isTooDeep = (error: Error): boolean =>
  error instanceof TooDeepError || isStackOverflow(error);

const withinStack = <T>(run: () => T): T | null => {
  try {
    return run();
  } catch (error) {
    if (error instanceof Error && isStackOverflow(error)) {
      return null;
    }
    throw error;
  }
};

// a list is flat in the model, so only its indent says how deep the writer must nest it
const nestsTooDeep = (blocks: readonly TElement[]): boolean =>
  blocks.some((block) =>
    [...NodeApi.nodes(block)].some(
      ([node]) => ElementApi.isElement(node) && (numberProp(node, "indent") ?? 0) > LIST_MAX_INDENT,
    ),
  );

// a file saved on Windows ends its lines in CRLF; Plate's deserialize reads either, but a split ahead
// of it (the frontmatter's) or a paste must see one line ending
export const lfOnly = (text: string): string => text.replaceAll(/\r\n?/gu, "\n");

// how a read takes markdown: `wiki` resolves Obsidian's `[[…]]`, which only an import and the
// agent's text name; every other read leaves them the text they are
export interface ReadOptions {
  readonly wiki?: WikiResolve | undefined;
}

export const readMarkdown = (
  editor: SlateEditor,
  md: string,
  options: ReadOptions = {},
): MarkdownRead => {
  const failures: Error[] = [];
  const { wiki } = options;
  const nodes = withinStack(() =>
    editor.getApi(MarkdownPlugin).markdown.deserialize(md, {
      onError: (error: Error) => {
        failures.push(error);
      },
      remarkPlugins: [
        remarkReadDepth,
        ...MD_REMARK_PLUGINS,
        ...(wiki === undefined ? [] : [remarkWikiImport(wiki)]),
      ],
      withoutMdx: true,
    }),
  );
  if (nodes === null) {
    return { ok: false, reason: { kind: "too-deep" } };
  }
  const [failed] = failures;
  if (failed !== undefined) {
    return {
      ok: false,
      reason: isTooDeep(failed) ? { kind: "too-deep" } : { error: failed, kind: "failed" },
    };
  }
  const value = nodes.filter((node) => ElementApi.isElement(node));
  if (value.length !== nodes.length) {
    return {
      ok: false,
      reason: { error: new Error("a root text survived the read"), kind: "failed" },
    };
  }
  return nestsTooDeep(value) ? { ok: false, reason: { kind: "too-deep" } } : { ok: true, value };
};
