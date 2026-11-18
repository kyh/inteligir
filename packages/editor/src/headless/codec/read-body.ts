// Markdown as a body's blocks: the one read every door into a body takes (a note an agent or a
// save writes, an edit's new text, a page a fill read), so the same text is the same blocks at
// each. It has no frontmatter and no sections, which are a file's (`item-markdown.ts`): a `---`
// block opening the text is a YAML code block, and an `:::article` the blocks inside it. A pill's
// label is whatever its writer put there and no editor normalizes a read, so a whole body's pills
// are settled here; part of one lands through the note's editor, which settles them among all the
// note holds.

import type { TElement } from "platejs";

import { settledAlone } from "@repo/editor/headless/formulas/pill-nodes";
import { parseMarkdown } from "@repo/editor/headless/markdown/markdown-doc";
import type { MarkdownRead } from "@repo/editor/headless/markdown/md-read";
import type { WikiResolve } from "@repo/editor/headless/markdown/remark-wiki-import";

import { nameDrafts } from "./name-blocks";
import type { NamedBlocks } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import type { ReadPorts } from "./read-blocks";

export interface BodyPorts {
  // what an item link and an image's address name in the library
  readonly links: ReadPorts;
  readonly newBlockId: () => string;
  // what a `[[…]]` names, for text that may hold one
  readonly wiki?: WikiResolve | undefined;
}

export type BodyRead = ({ readonly ok: true } & NamedBlocks) | Extract<MarkdownRead, { ok: false }>;

// the editor's value as blocks the library stores
export const storedBlocks = (value: readonly TElement[], ports: BodyPorts): NamedBlocks =>
  nameDrafts(readBlocks(value, ports.links), ports.newBlockId);

const blocksOf = (
  markdown: string,
  ports: BodyPorts,
  settled: (value: readonly TElement[]) => readonly TElement[],
): BodyRead => {
  const read = parseMarkdown(markdown, undefined, { wiki: ports.wiki });
  return read.ok ? { ok: true, ...storedBlocks(settled(read.value), ports) } : read;
};

export const readBody = (markdown: string, ports: BodyPorts): BodyRead =>
  blocksOf(markdown, ports, settledAlone);

// part of a body, as an edit's new text is: a pill in it may read one the rest of the note holds
export const readBodyPart = (markdown: string, ports: BodyPorts): BodyRead =>
  blocksOf(markdown, ports, (value) => value);
