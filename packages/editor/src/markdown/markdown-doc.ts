// Markdown in and out of an item's blocks, headless. Markdown is stock and lossy: a read keeps every
// letter a person wrote, and a write keeps what the blocks mean, never the bytes they came from.

import type { Root } from "mdast";
import { ElementApi, createSlateEditor } from "platejs";
import type { SlateEditor, TElement, Value } from "platejs";
import { MarkdownPlugin } from "@platejs/markdown";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { recordFlowSpans } from "@repo/editor/markdown/flow-spans";
import type { FlowSpan } from "@repo/editor/markdown/flow-spans";
import { MD_STRINGIFY } from "@repo/editor/markdown/md-plugins";
import { readMarkdown } from "@repo/editor/markdown/md-read";
import type { MarkdownRead, ReadOptions } from "@repo/editor/markdown/md-read";
import {
  ARTICLE_SECTION_KEY,
  markListNesting,
  nestInLists,
  pruneEmptyEquations,
} from "@repo/editor/markdown/md-rules";

// fresh per call: Slate editors carry mutable state
export const headlessEditor = (): SlateEditor => createSlateEditor({ plugins: BASE_KIT });

const isSection = (block: TElement): boolean => block.type === ARTICLE_SECTION_KEY;

// the editor holds no section, so an `:::article` reads as the blocks inside it
const flattenSections = (blocks: readonly TElement[]): TElement[] =>
  blocks.flatMap((block) =>
    isSection(block) ? block.children.filter((child) => ElementApi.isElement(child)) : [block],
  );

export const parseMarkdown = (
  md: string,
  editor: SlateEditor = headlessEditor(),
  options: ReadOptions = {},
): MarkdownRead => {
  const read = readMarkdown(editor, md, options);
  return read.ok ? { ok: true, value: flattenSections(read.value) } : read;
};

export interface MarkdownSections {
  readonly note: TElement[];
  // the page a fill read, which an export writes inside a top-level `:::article`
  readonly article: TElement[] | null;
}

// an item's file: what stands outside a top-level `:::article` is the note, what it holds the page
export const parseMarkdownSections = (
  md: string,
  editor: SlateEditor = headlessEditor(),
  options: ReadOptions = {},
): { ok: true; sections: MarkdownSections } | Extract<MarkdownRead, { ok: false }> => {
  const read = readMarkdown(editor, md, options);
  if (!read.ok) {
    return read;
  }
  const sections = read.value.filter(isSection);
  return {
    ok: true,
    sections: {
      article: sections.length === 0 ? null : flattenSections(sections),
      note: read.value.filter((block) => !isSection(block)),
    },
  };
};

export const serializeNote = (editor: SlateEditor, value: Value = editor.children): string =>
  editor
    .getApi(MarkdownPlugin)
    .markdown.serialize({ value: markListNesting(pruneEmptyEquations(value)) });

export interface SpannedNote {
  readonly markdown: string;
  // where each top-level node the rules wrote (a block, or a run of list items as one list) sits
  readonly spans: readonly FlowSpan[];
}

// the same bytes, with where each top-level node landed: what the codec's view of an item maps an
// edit back to its blocks by
export const serializeNoteSpans = (editor: SlateEditor, value: Value): SpannedNote => {
  const recorder = recordFlowSpans();
  const markdown = editor.getApi(MarkdownPlugin).markdown.serialize({
    remarkStringifyOptions: {
      ...MD_STRINGIFY,
      handlers: {
        ...MD_STRINGIFY.handlers,
        root: (node: Root, parent, state, info) =>
          recorder.root({ ...node, children: nestInLists(node.children) }, parent, state, info),
      },
    },
    value: markListNesting(pruneEmptyEquations(value)),
  });
  return { markdown, spans: recorder.spans };
};

const LETTER_RE = /[\p{L}\p{N}]/gu;

const letterCounts = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [letter] of text.toLowerCase().matchAll(LETTER_RE)) {
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return counts;
};

// the share of the source's letters and digits the written text still holds, as a multiset, so a
// letter dropped is not paid back by one the writer added
/** @internal */
export const lettersKept = (source: string, written: string): number => {
  const before = letterCounts(source);
  const after = letterCounts(written);
  let total = 0;
  let kept = 0;
  for (const [letter, count] of before) {
    total += count;
    kept += Math.min(count, after.get(letter) ?? 0);
  }
  return total === 0 ? 1 : kept / total;
};

// an imported page (the fill's article) as the bytes its blocks write
export interface ImportedDoc {
  markdown: string;
  kept: number;
}

// null when the read refuses the page: a page is hostile input, so no failure escapes the fill
export const canonicalizeImported = (md: string): ImportedDoc | null => {
  if (md.trim() === "") {
    return { kept: 1, markdown: "" };
  }
  const editor = headlessEditor();
  const read = parseMarkdown(md, editor);
  if (!read.ok) {
    return null;
  }
  const markdown = `${serializeNote(editor, read.value).trimEnd()}\n`;
  return { kept: lettersKept(md, markdown), markdown };
};
