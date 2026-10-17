// An item's cover, its original file and its page copy are read from its body's links every time,
// never stored: a frontmatter path would be one a rename's link rewrite and the phone never see.

import type { ExtractedLink } from "../knowledge/link-extract";
import { COVERS_DIR, fileKindOf, PAGES_DIR } from "./item-kind";
import type { ItemKind } from "./item-kind";

export interface ItemFileRefs {
  cover: string | null;
  file: string | null;
  copy: string | null;
}

// only the first embeds count: a cover sits at the top, and an article's own images further down
// are its text, not its card
const EMBEDS_CONSIDERED = 8;

const isCover = (path: string): boolean => path.startsWith(`${COVERS_DIR}/`);

const isPageCopy = (path: string): boolean =>
  path.startsWith(`${PAGES_DIR}/`) && path.toLowerCase().endsWith(".html");

const originalOf = (
  kind: ItemKind,
  embeds: readonly string[],
  cover: string | null,
): string | null => {
  switch (kind) {
    case "image": {
      return embeds.find((path) => fileKindOf(path) === "image" && !isCover(path)) ?? cover;
    }
    case "pdf":
    case "video":
    case "audio": {
      return embeds.find((path) => fileKindOf(path) === kind) ?? null;
    }
    case "file": {
      return embeds.find((path) => !isCover(path)) ?? null;
    }
    case "note":
    case "link": {
      return null;
    }
    // no default
  }
};

export const itemFilesOf = (args: {
  kind: ItemKind;
  // the doc's stored links, in document order
  links: readonly ExtractedLink[];
  // a link's vault path when it names a file that is not a doc, else null
  resolve: (link: ExtractedLink) => string | null;
}): ItemFileRefs => {
  const embeds = args.links
    .filter((link) => link.embed)
    .slice(0, EMBEDS_CONSIDERED)
    .flatMap((link) => {
      const path = args.resolve(link);
      return path === null ? [] : [path];
    });
  const cover = embeds.find((path) => fileKindOf(path) === "image") ?? null;
  let copy: string | null = null;
  for (const link of args.links) {
    const path = args.resolve(link);
    if (path !== null && isPageCopy(path)) {
      copy = path;
      break;
    }
  }
  return { copy, cover, file: originalOf(args.kind, embeds, cover) };
};
