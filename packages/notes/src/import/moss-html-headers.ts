// Moss allowed options after the `moss-html` fence header and normalizes them
// away at read; our grammar treats the header as exact. The import applies
// Moss's own normalization once: an OPENING ```moss-html line loses whatever
// follows the language word. The walk tracks fences itself because the shared
// active-line mask hides opening lines — here they are the edit target.

const MOSS_HTML_HEADER_RE = /^( {0,3})(`{3,})moss-html(?:\s+.*)?$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

export type MossHtmlHeaderResult = { body: string; normalized: number };

export function normalizeMossHtmlHeaders(md: string): MossHtmlHeaderResult {
  if (!md.includes("moss-html")) return { body: md, normalized: 0 };
  const lines = md.split("\n");
  let frontmatterEnd = -1;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) frontmatterEnd = close;
  }
  let fence: { char: string; length: number } | null = null;
  let normalized = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || i <= frontmatterEnd) continue;
    if (fence !== null) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith(fence.char.repeat(fence.length)) &&
        trimmed.replaceAll(fence.char, "") === ""
      ) {
        fence = null;
      }
      continue;
    }
    const header = MOSS_HTML_HEADER_RE.exec(line);
    if (header !== null && header[1] !== undefined && header[2] !== undefined) {
      const canonical = `${header[1]}${header[2]}moss-html`;
      if (line !== canonical) {
        lines[i] = canonical;
        normalized++;
      }
      fence = { char: "`", length: header[2].length };
      continue;
    }
    const open = FENCE_OPEN_RE.exec(line);
    if (open !== null && open[1] !== undefined) {
      const marker = open[1][0];
      if (marker !== undefined) fence = { char: marker, length: open[1].length };
    }
  }
  return { body: normalized > 0 ? lines.join("\n") : md, normalized };
}
