import { docExtension, docStem } from "@repo/notes/knowledge/doc-file";

// the bare stem when it uniquely resolves back to the path, else the path minus its doc
// extension; the extension hidden is the domain's, so a `.markdown` note links the same way everywhere.
export function wikiBodyForPath(
  path: string,
  resolveWiki: (target: string) => string | null,
): string {
  const base = docStem(path);
  if (resolveWiki(base) === path) return base;
  return path.slice(0, path.length - docExtension(path).length);
}

export function composeWikiBody(
  target: string,
  parts: { anchor?: string | undefined; alias?: string | undefined },
): string {
  const anchor = parts.anchor !== undefined && parts.anchor !== "" ? `#${parts.anchor}` : "";
  const alias = parts.alias !== undefined && parts.alias !== "" ? `|${parts.alias}` : "";
  return `${target}${anchor}${alias}`;
}
