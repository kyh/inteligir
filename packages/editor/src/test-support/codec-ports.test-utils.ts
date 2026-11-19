import { fileKindOf } from "@repo/contract/items/item-kind";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import type { WikiReach, WikiTarget } from "@repo/editor/headless/markdown/remark-wiki-import";

import type { FoundFile, ImportPorts } from "../headless/codec/item-markdown";
import type { LinkedItem } from "../headless/codec/read-blocks";
import type { WritePorts, WrittenFile } from "../headless/codec/write-blocks";

export const CODEC_NOW = 1_780_004_800_000;

const PRIME = 4_294_967_291;

const fakeSha = (path: string) => {
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

interface PretendLibrary {
  readonly importPorts: () => ImportPorts;
  readonly writePorts: () => WritePorts;
  readonly titles: ReadonlyMap<string, string>;
}

export const pretendLibrary = () => {
  const titles = new Map<string, string>();
  const paths = new Map<string, string>();

  const fileAt = (path: string) => {
    const kind = fileKindOf(path);

    if (kind === null || path.includes("://") || !/\.[A-Za-z0-9]+$/u.test(path)) {
      return null;
    }

    const sha = fakeSha(path);
    paths.set(sha, path);

    return {
      kind,
      name: path.slice(path.lastIndexOf("/") + 1),
      path,
      place: path,
      sha,
    } satisfies FoundFile | null;
  };

  const wiki = (link: WikiTarget, embed: boolean) => {
    if (embed) {
      const file = fileAt(link.target);

      if (file !== null) {
        return { kind: "file", url: file.path } satisfies WikiReach;
      }
    }

    const itemId = `item-${fakeSha(link.target).slice(0, 12)}`;
    titles.set(itemId, link.target);

    return { itemId, kind: "item", title: link.target } satisfies WikiReach;
  };

  const item = (key: string) => {
    const title = titles.get(key);

    return (title === undefined ? null : { itemId: key, title }) satisfies LinkedItem | null;
  };

  return {
    writePorts: () => ({
      path: (file: WrittenFile) => paths.get(file.sha) ?? `assets/${file.sha}`,
      target: (itemId: string) => titles.get(itemId) ?? null,
    }),
    importPorts: () => {
      let blocks = 0;

      return {
        file: fileAt,
        item,
        newBlockId: () => {
          blocks += 1;

          return `b${String(blocks)}`;
        },
        now: CODEC_NOW,
        wiki,
      };
    },
    titles,
  } satisfies PretendLibrary;
};

export const withoutId = (block: LibraryBlock) => {
  const { id: _id, ...content } = block;

  return content;
};
