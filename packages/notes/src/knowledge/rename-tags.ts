// A tag rename is the link rename's surgery on the tag grammar: only spans the scan verified
// are spliced, and frontmatter `tags` re-serialize through the CST edit the properties panel
// uses, so every other key keeps its bytes. The match is case-insensitive because the index
// is; the replacement is spelled exactly as asked.

import {
  frontmatterYaml,
  parseProperties,
  serializeProperties,
  splitFrontmatter,
  type TypedProperty,
} from "../markdown/frontmatter";
import { documentTagSpans, type InlineTagSpan } from "./link-extract";

// `from` names a tag and everything nested under it: the rail folds `area/deep` under `area`,
// so renaming the row moves the family.
export function tagInFamily(tag: string, from: string): boolean {
  const lower = tag.toLowerCase();
  const fromLower = from.toLowerCase();
  return lower === fromLower || lower.startsWith(`${fromLower}/`);
}

export function renamedTag(tag: string, from: string, to: string): string | null {
  return tagInFamily(tag, from) ? `${to}${tag.slice(from.length)}` : null;
}

function rewriteInlineTags(content: string, from: string, to: string): string {
  const replacements: Array<{ span: InlineTagSpan; text: string }> = [];
  for (const span of documentTagSpans(content)) {
    const next = renamedTag(span.tag, from, to);
    if (next !== null) replacements.push({ span, text: `#${next}` });
  }
  // back-to-front so earlier spans stay valid; spans come from one scan and never overlap
  let out = content;
  for (const { span, text } of replacements.toSorted((a, b) => b.span.start - a.span.start)) {
    out = out.slice(0, span.start) + text + out.slice(span.end);
  }
  return out;
}

function rewriteFrontmatterTags(content: string, from: string, to: string): string {
  const yaml = frontmatterYaml(content);
  if (yaml === null) return content;
  const parsed = parseProperties(yaml);
  if (parsed.kind !== "valid") return content;
  let changed = false;
  const properties = parsed.properties.map((prop): TypedProperty => {
    if (prop.key !== "tags" || prop.type !== "tags") return prop;
    const value = prop.value.map((raw) => {
      const hashed = raw.startsWith("#");
      const next = renamedTag((hashed ? raw.slice(1) : raw).trim(), from, to);
      if (next === null) return raw;
      changed = true;
      return hashed ? `#${next}` : next;
    });
    return { key: prop.key, type: "tags", value };
  });
  if (!changed) return content;
  return `---\n${serializeProperties(properties, yaml)}\n---\n${splitFrontmatter(content).body}`;
}

export function renameTagsInDoc(content: string, from: string, to: string): string {
  return rewriteFrontmatterTags(rewriteInlineTags(content, from, to), from, to);
}

// `docs` is keyed by path; the result holds changed docs only
export function computeTagRenameEdits(
  docs: ReadonlyMap<string, string>,
  from: string,
  to: string,
): Map<string, string> {
  const edits = new Map<string, string>();
  if (from === to) return edits;
  for (const [path, content] of docs) {
    const next = renameTagsInDoc(content, from, to);
    if (next !== content) edits.set(path, next);
  }
  return edits;
}
