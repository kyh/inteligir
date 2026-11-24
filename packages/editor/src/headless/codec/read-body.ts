import type { TElement } from "platejs";

import { settledAlone } from "@repo/editor/headless/formulas/pill-nodes";
import { parseMarkdown } from "@repo/editor/headless/codec/markdown-doc";
import type { MarkdownRead } from "@repo/editor/headless/markdown/md-read";
import type { WikiResolve } from "@repo/editor/headless/markdown/remark-wiki-import";

import { nameDrafts } from "./name-blocks";
import type { NamedBlocks } from "./name-blocks";
import { readBlocks } from "./read-blocks";
import type { ReadPorts } from "./read-blocks";

export interface BodyPorts {
  readonly links: ReadPorts;
  readonly newBlockId: () => string;
  readonly wiki?: WikiResolve | undefined;
}

export type BodyRead = ({ readonly ok: true } & NamedBlocks) | Extract<MarkdownRead, { ok: false }>;

export const storedBlocks = (value: readonly TElement[], ports: BodyPorts) =>
  nameDrafts(readBlocks(value, ports.links), ports.newBlockId);

const blocksOf = (
  markdown: string,
  ports: BodyPorts,
  settled: (value: readonly TElement[]) => readonly TElement[],
) => {
  const read = parseMarkdown(markdown, undefined, { wiki: ports.wiki });

  return (
    read.ok ? { ok: true, ...storedBlocks(settled(read.value), ports) } : read
  ) satisfies BodyRead;
};

export const readBody = (markdown: string, ports: BodyPorts) =>
  blocksOf(markdown, ports, settledAlone);

export const readBodyPart = (markdown: string, ports: BodyPorts) =>
  blocksOf(markdown, ports, (value) => value);
