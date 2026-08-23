// The hover preview's text: a note's head as PLAIN prose — frontmatter and
// dialect plumbing dropped, formatting characters stripped — never a nested
// editor. Regex-level on purpose: a hover tooltip earns a cheap
// approximation, not a parse.

const PREVIEW_MAX_LINES = 20;

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const COMMENT_MARKER_RE = /%%i:[^%]*%%/g;
const WIKI_LINK_RE = /\[\[([^\]]*)\]\]/g;
const MD_LINK_RE = /!?\[([^\]]*)\]\([^)]*\)/g;
const FORMULA_RE = /\{\{[^}]*\}\}/g;
const HEADING_RE = /^#{1,6}\s+/;
const BLOCKQUOTE_RE = /^>\s?/;
const EMPHASIS_RE = /(\*\*|__|\*|_|~~|`)/g;

function wikiBodyLabel(body: string): string {
  const pipe = body.lastIndexOf("|");
  return pipe === -1 ? body : body.slice(pipe + 1);
}

/** The first ~20 content lines of `markdown`, as stripped plain text. */
export function notePreviewHead(markdown: string): string {
  const body = markdown.replace(FRONTMATTER_RE, "");
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    if (lines.length >= PREVIEW_MAX_LINES) break;
    const line = raw
      .replace(COMMENT_MARKER_RE, "")
      .replace(WIKI_LINK_RE, (_, inner: string) => wikiBodyLabel(inner))
      .replace(MD_LINK_RE, "$1")
      .replace(FORMULA_RE, "")
      .replace(HEADING_RE, "")
      .replace(BLOCKQUOTE_RE, "")
      .replace(EMPHASIS_RE, "")
      .trimEnd();
    if (line.trim() === "" && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(line.trim() === "" ? "" : line);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
