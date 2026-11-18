// A markdown file's frontmatter fence: its YAML as written and where the block ends. What the
// YAML says is `@repo/editor/headless/codec/item-fields`'s to read.

// remark-frontmatter's default `yaml` fence, read past the BOM micromark skips; the content group
// is optional so an empty block matches
const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n(?:(?<yaml>[\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/u;

export const frontmatterYaml = (text: string): string | null => {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return null;
  }
  return match.groups?.yaml ?? "";
};

// the offset the block ends at, its BOM included: where a reader that withholds the header cuts.
export const frontmatterEnd = (text: string): number | null =>
  FRONTMATTER_RE.exec(text)?.[0].length ?? null;
