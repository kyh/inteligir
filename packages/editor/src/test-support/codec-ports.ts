// A codec's ports over a pretend library: every wiki target an item titled as written, every
// address with a file's extension a file whose sha the address names, ids from counters and one
// fixed instant, so an import twice over the same text answers the same item.

import { fileKindOf } from "@repo/notes/items/item-kind";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import type { WikiBody } from "@repo/notes/markdown/remark-wiki-link";

import type { ExportPorts, FoundFile, ImportPorts } from "../codec/item-markdown";
import type { Reached } from "../codec/read-blocks";
import type { WrittenFile } from "../codec/write-blocks";

// 2026-05-28T21:46:40Z, a whole second
export const CODEC_NOW = 1_780_004_800_000;

// 64 hex digits this path spells, by a rolling hash per round (a pretend sha, not a digest)
const PRIME = 4_294_967_291;
const fakeSha = (path: string): string => {
  let hex = "";
  for (let round = 1; hex.length < 64; round += 1) {
    let hash = round;
    for (const char of path) {
      hash = (hash * (31 + round) + (char.codePointAt(0) ?? 0)) % PRIME;
    }
    hex += hash.toString(16).padStart(8, "0");
  }
  return hex.slice(0, 64);
};

export interface PretendLibrary {
  readonly importPorts: () => ImportPorts;
  readonly exportPorts: () => ExportPorts;
  readonly titles: ReadonlyMap<string, string>;
}

export const pretendLibrary = (): PretendLibrary => {
  const titles = new Map<string, string>();
  const paths = new Map<string, string>();
  // a name with a file's extension; one with none is a note's
  const fileAt = (path: string): FoundFile | null => {
    const kind = fileKindOf(path);
    if (kind === null || path.includes("://") || !/\.[A-Za-z0-9]+$/u.test(path)) {
      return null;
    }
    const sha = fakeSha(path);
    paths.set(sha, path);
    return { kind, name: path.slice(path.lastIndexOf("/") + 1), path, place: path, sha };
  };
  const wiki = (link: WikiBody, embed: boolean): Reached => {
    if (embed) {
      const file = fileAt(link.target);
      if (file !== null) {
        return { file, kind: "file" };
      }
    }
    const itemId = `item-${fakeSha(link.target).slice(0, 12)}`;
    titles.set(itemId, link.target);
    return { itemId, kind: "item", title: link.target };
  };
  return {
    exportPorts: () => ({
      held: (sha: string) => paths.get(sha) ?? `assets/${sha}`,
      path: (file: WrittenFile) => paths.get(file.sha) ?? `assets/${file.sha}`,
      target: (itemId: string) => titles.get(itemId) ?? null,
      withIds: false,
    }),
    importPorts: () => {
      let blocks = 0;
      let highlights = 0;
      return {
        file: fileAt,
        newAnnotationId: () => {
          highlights += 1;
          return `hl${String(highlights)}`;
        },
        newBlockId: () => {
          blocks += 1;
          return `b${String(blocks)}`;
        },
        now: CODEC_NOW,
        wiki,
      };
    },
    titles,
  };
};

// a block as content alone: what two imports of one text agree on whatever ids they minted
export const withoutId = (block: LibraryBlock): Omit<LibraryBlock, "id"> => {
  const { id: _id, ...content } = block;
  return content;
};
