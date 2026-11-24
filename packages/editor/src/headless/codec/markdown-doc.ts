import { ElementApi, createSlateEditor } from "platejs";
import type { SlateEditor, TElement, Value } from "platejs";
import { MarkdownPlugin } from "@platejs/markdown";

import { BASE_KIT } from "@repo/editor/headless/kits/base-kit";
import { readMarkdown } from "@repo/editor/headless/markdown/md-read";
import type { MarkdownRead, ReadOptions } from "@repo/editor/headless/markdown/md-read";
import {
  ARTICLE_SECTION_KEY,
  markListNesting,
  pruneEmptyEquations,
} from "@repo/editor/headless/markdown/md-rules";

export const headlessEditor = () => createSlateEditor({ plugins: BASE_KIT });

const isSection = (block: TElement) => block.type === ARTICLE_SECTION_KEY;

const flattenSections = (blocks: readonly TElement[]) =>
  blocks.flatMap((block) =>
    isSection(block) ? block.children.filter((child) => ElementApi.isElement(child)) : [block],
  );

export const parseMarkdown = (
  md: string,
  editor: SlateEditor = headlessEditor(),
  options: ReadOptions = {},
) => {
  const read = readMarkdown(editor, md, options);

  return (read.ok ? { ok: true, value: flattenSections(read.value) } : read) satisfies MarkdownRead;
};

interface MarkdownSections {
  readonly note: TElement[];
  readonly article: TElement[] | null;
}

export const parseMarkdownSections = (
  md: string,
  editor: SlateEditor = headlessEditor(),
  options: ReadOptions = {},
) => {
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
  } satisfies { ok: true; sections: MarkdownSections } | Extract<MarkdownRead, { ok: false }>;
};

export const serializeNote = (editor: SlateEditor, value: Value = editor.children) =>
  editor
    .getApi(MarkdownPlugin)
    .markdown.serialize({ value: markListNesting(pruneEmptyEquations(value)) });

const LETTER_RE = /[\p{L}\p{N}]/gu;

const letterCounts = (text: string) => {
  const counts = new Map<string, number>();

  for (const [letter] of text.toLowerCase().matchAll(LETTER_RE)) {
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }

  return counts;
};

export const lettersKept = (source: string, written: string) => {
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
