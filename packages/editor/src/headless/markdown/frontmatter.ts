const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n(?:(?<yaml>[\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/u;

export const frontmatterYaml = (text: string) => {
  const match = FRONTMATTER_RE.exec(text);

  if (!match) {
    return null;
  }

  return match.groups?.yaml ?? "";
};

export const frontmatterEnd = (text: string) => FRONTMATTER_RE.exec(text)?.[0].length ?? null;
