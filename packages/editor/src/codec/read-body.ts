// Markdown as a body's blocks: the one read every door into a body takes (a note an agent or a
// save writes, an edit's new text, a page a fill read), so the same text is the same blocks at
// each. It has no frontmatter and no sections, which are a file's (`item-markdown.ts`): a `---`
// block opening the text is a YAML code block, and an `:::article` the blocks inside it.

import type { TElement } from "platejs";

import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import type { MarkdownRead } from "@repo/editor/markdown/md-read";
import type { WikiResolve } from "@repo/editor/markdown/remark-wiki-import";

import { nameDrafts } from "./name-blocks";
import type { NamedBlocks } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import type { ReadPorts } from "./read-blocks";

export interface BodyPorts {
  // what a page link and an image's address name in the library
  readonly links: ReadPorts;
  readonly newBlockId: () => string;
  // what a `[[…]]` names, for text that may hold one
  readonly wiki?: WikiResolve | undefined;
}

export type BodyRead = ({ readonly ok: true } & NamedBlocks) | Extract<MarkdownRead, { ok: false }>;

// the editor's value as blocks the library stores
export const storedBlocks = (value: readonly TElement[], ports: BodyPorts): NamedBlocks =>
  nameDrafts(readBlocks(value, ports.links), ports.newBlockId);

export const readBody = (markdown: string, ports: BodyPorts): BodyRead => {
  const read = parseMarkdown(markdown, undefined, { wiki: ports.wiki });
  return read.ok ? { ok: true, ...storedBlocks(read.value, ports) } : read;
};
