// The one read into blocks: markdown through Plate's own deserialize over the dialect's plugins and
// rules, with no MDX pre-pass, or a tree a reader already holds through those same rules, and a
// failure said as a refusal rather than a degraded model.

import type { Nodes, Root } from "mdast";
import { ElementApi, KEYS, NodeApi } from "platejs";
import type { Descendant, SlateEditor, TElement } from "platejs";
import type { Plugin, Transformer } from "unified";
import { MarkdownPlugin, getMergedOptionsDeserialize, mdastToSlate } from "@platejs/markdown";

import { BLOCK_MAX_DEPTH, LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";
import { MD_REMARK_PLUGINS } from "@repo/editor/headless/markdown/md-plugins";
import { remarkWikiImport } from "@repo/editor/headless/markdown/remark-wiki-import";
import type { WikiResolve } from "@repo/editor/headless/markdown/remark-wiki-import";
import { numberProp } from "@repo/editor/headless/node-props";

import { isMdastRoot } from "./mdast-nodes";

export type MarkdownRefusal = { kind: "too-deep" } | { kind: "failed"; error: Error };

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
const refuseTooDeep = (tree: Root): void => {
  const pending: { depth: number; node: Nodes }[] = [{ depth: 0, node: tree }];
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

const remarkReadDepth: Plugin = function remarkReadDepth(): Transformer {
  return (tree) => {
    if (isMdastRoot(tree)) {
      refuseTooDeep(tree);
    }
  };
};

const TOO_DEEP: MarkdownRead = { ok: false, reason: { kind: "too-deep" } };

const refusal = (error: Error): MarkdownRead =>
  error instanceof TooDeepError || isStackOverflow(error)
    ? TOO_DEEP
    : { ok: false, reason: { error, kind: "failed" } };

// a read never throws: a stack that ran out under it is the refusal a tree measured too deep is
const refusing = (read: () => MarkdownRead): MarkdownRead => {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error) {
      return refusal(error);
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

// a text at the root is a paragraph of its own, as Plate's markdown read already wraps one
const heldBlocks = (nodes: readonly Descendant[]): MarkdownRead => {
  const value = nodes.map((node) =>
    ElementApi.isElement(node) ? node : { children: [node], type: KEYS.p },
  );
  return nestsTooDeep(value) ? TOO_DEEP : { ok: true, value };
};

export const readMarkdown = (
  editor: SlateEditor,
  md: string,
  options: ReadOptions = {},
): MarkdownRead =>
  refusing(() => {
    const failures: Error[] = [];
    const { wiki } = options;
    const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(md, {
      onError: (error: Error) => {
        failures.push(error);
      },
      remarkPlugins: [
        remarkReadDepth,
        ...MD_REMARK_PLUGINS,
        ...(wiki === undefined ? [] : [remarkWikiImport(wiki)]),
      ],
      withoutMdx: true,
    });
    const [failed] = failures;
    return failed === undefined ? heldBlocks(nodes) : refusal(failed);
  });

// A tree a reader built from something other than markdown (a saved page's html), read by the rule
// table alone: no parser and no plugin runs over it, so a text node is the text it holds and
// nothing in it reads as a construct the dialect spells.
export const readMdast = (editor: SlateEditor, root: Root): MarkdownRead =>
  refusing(() => {
    refuseTooDeep(root);
    return heldBlocks(mdastToSlate(root, getMergedOptionsDeserialize(editor)));
  });
