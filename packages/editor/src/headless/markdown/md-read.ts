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

const isStackOverflow = (error: Error) =>
  error instanceof RangeError ||
  (error instanceof SyntaxError && error.message.endsWith(": Stack overflow"));

const READ_MAX_DEPTH = 2 * (LIST_MAX_INDENT + 1) + 2 * BLOCK_MAX_DEPTH;

class TooDeepError extends Error {
  override name = "TooDeepError";
}

const refuseTooDeep = (tree: Root) => {
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

const remarkReadDepth: Plugin = function remarkReadDepth() {
  return ((tree) => {
    if (isMdastRoot(tree)) {
      refuseTooDeep(tree);
    }
  }) satisfies Transformer;
};

const TOO_DEEP: MarkdownRead = { ok: false, reason: { kind: "too-deep" } };

const refusal = (error: Error) =>
  (error instanceof TooDeepError || isStackOverflow(error)
    ? TOO_DEEP
    : { ok: false, reason: { error, kind: "failed" } }) satisfies MarkdownRead;

const refusing = (read: () => MarkdownRead) => {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error) {
      return refusal(error);
    }

    throw error;
  }
};

const nestsTooDeep = (blocks: readonly TElement[]) =>
  blocks.some((block) =>
    [...NodeApi.nodes(block)].some(
      ([node]) => ElementApi.isElement(node) && (numberProp(node, "indent") ?? 0) > LIST_MAX_INDENT,
    ),
  );

export const lfOnly = (text: string) => text.replaceAll(/\r\n?/gu, "\n");

export interface ReadOptions {
  readonly wiki?: WikiResolve | undefined;
}

const heldBlocks = (nodes: readonly Descendant[]) => {
  const value = nodes.map((node) =>
    ElementApi.isElement(node) ? node : { children: [node], type: KEYS.p },
  );

  return (nestsTooDeep(value) ? TOO_DEEP : { ok: true, value }) satisfies MarkdownRead;
};

export const readMarkdown = (editor: SlateEditor, md: string, options: ReadOptions = {}) =>
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

export const readMdast = (editor: SlateEditor, root: Root) =>
  refusing(() => {
    refuseTooDeep(root);

    return heldBlocks(mdastToSlate(root, getMergedOptionsDeserialize(editor)));
  });
