// regex-level on purpose: a hover tooltip earns a cheap approximation, not a parse.

const PREVIEW_MAX_LINES = 20;

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/u;
const COMMENT_MARKER_RE = /%%i:[^%]*%%/gu;
const WIKI_LINK_RE = /\[\[(?<inner>[^\]]*)\]\]/gu;
const MD_LINK_RE = /!?\[(?<label>[^\]]*)\]\([^)]*\)/gu;
const FORMULA_RE = /\{\{[^}]*\}\}/gu;
const HEADING_RE = /^#{1,6}\s+/u;
const BLOCKQUOTE_RE = /^>\s?/u;
const EMPHASIS_RE = /(?:\*\*|__|\*|_|~~|`)/gu;

const wikiBodyLabel = (body: string): string => {
  const pipe = body.lastIndexOf("|");
  return pipe === -1 ? body : body.slice(pipe + 1);
};

export const notePreviewHead = (markdown: string): string => {
  const body = markdown.replace(FRONTMATTER_RE, "");
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    if (lines.length >= PREVIEW_MAX_LINES) {
      break;
    }
    const line = raw
      .replace(COMMENT_MARKER_RE, "")
      .replace(WIKI_LINK_RE, (_, inner: string) => wikiBodyLabel(inner))
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
