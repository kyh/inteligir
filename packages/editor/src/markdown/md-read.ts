// The one read of markdown into blocks: Plate's own deserialize over the dialect's plugins and
// rules, with no MDX pre-pass, and a failure said as a refusal rather than a degraded model.

import { ElementApi, NodeApi } from "platejs";
import type { SlateEditor, TElement } from "platejs";
import { MarkdownPlugin } from "@platejs/markdown";

import { LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";
import { MD_REMARK_PLUGINS } from "@repo/editor/markdown/md-plugins";
import { remarkWikiImport } from "@repo/editor/markdown/remark-wiki-import";
import type { WikiResolve } from "@repo/editor/markdown/remark-wiki-import";
import { numberProp } from "@repo/editor/node-props";

export type MarkdownRefusal = { kind: "too-deep" } | { kind: "failed"; error: Error };

export type MarkdownRead = { ok: true; value: TElement[] } | { ok: false; reason: MarkdownRefusal };

// V8 says a stack ran out as a RangeError, or as this SyntaxError when it ran out compiling a
// regular expression; anything else is a real failure
const isStackOverflow = (error: Error): boolean =>
  error instanceof RangeError ||
  (error instanceof SyntaxError && error.message.endsWith(": Stack overflow"));

export const withinStack = <T>(run: () => T): T | null => {
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
      remarkPlugins:
        wiki === undefined ? undefined : [...MD_REMARK_PLUGINS, remarkWikiImport(wiki)],
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
      reason: isStackOverflow(failed) ? { kind: "too-deep" } : { error: failed, kind: "failed" },
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
