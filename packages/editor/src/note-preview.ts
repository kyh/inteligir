// regex-level on purpose: a hover tooltip earns a cheap approximation, not a parse.

import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";
import { COMMENT_MARKER_STRIP_RE } from "@repo/notes/markdown/remark-inline-constructs";
import { wikiLinkLabel } from "@repo/notes/markdown/remark-wiki-link";

const PREVIEW_MAX_LINES = 20;

const WIKI_LINK_RE = /!?\[\[(?<inner>[^\]]*)\]\]/gu;
const MD_LINK_RE = /!?\[(?<label>[^\]]*)\]\([^)]*\)/gu;
const FORMULA_RE = /\{\{[^}]*\}\}/gu;
const HEADING_RE = /^#{1,6}\s+/u;
const BLOCKQUOTE_RE = /^>\s?/u;
const EMPHASIS_RE = /(?:\*\*|__|\*|_|~~|`)/gu;

export const notePreviewHead = (markdown: string): string => {
  const { body } = splitFrontmatter(markdown);
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    if (lines.length >= PREVIEW_MAX_LINES) {
      break;
    }
    const line = raw
      .replace(COMMENT_MARKER_STRIP_RE, "")
      .replace(WIKI_LINK_RE, (_, inner: string) => wikiLinkLabel(inner))
      .replace(MD_LINK_RE, "$<label>")
      .replace(FORMULA_RE, "")
      .replace(HEADING_RE, "")
      .replace(BLOCKQUOTE_RE, "")
      .replace(EMPHASIS_RE, "")
      .trimEnd();
    if (line.trim() === "" && (lines.length === 0 || lines.at(-1) === "")) {
      continue;
    }
    lines.push(line.trim() === "" ? "" : line);
  }
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines.join("\n");
};
