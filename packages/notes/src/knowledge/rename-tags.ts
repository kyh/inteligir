// A tag rename is the link rename's surgery on the tag grammar: only spans the scan verified are
// spliced, and a frontmatter tag is spliced over its own yaml scalar in the style it was written
// in, so a flow list stays a flow list and every other byte, line endings included, stays put.
// The match is case-insensitive because the index is; the replacement is spelled exactly as asked.

import { frontmatterYaml, frontmatterYamlStart, yamlScalarText } from "../markdown/frontmatter";
import { documentTagSpans, frontmatterTags } from "./link-extract";
import type { Span } from "./link-extract";

// `from` names a tag and everything nested under it: the rail folds `area/deep` under `area`,
// so renaming the row moves the family.
export const tagInFamily = (tag: string, from: string): boolean => {
  const lower = tag.toLowerCase();
  const fromLower = from.toLowerCase();
  return lower === fromLower || lower.startsWith(`${fromLower}/`);
};

export const renamedTag = (tag: string, from: string, to: string): string | null =>
  tagInFamily(tag, from) ? `${to}${tag.slice(from.length)}` : null;

interface Replacement {
  span: Span;
  text: string;
}

const inlineReplacements = (content: string, from: string, to: string): Replacement[] =>
  documentTagSpans(content).flatMap((span) => {
    const next = renamedTag(span.tag, from, to);
    return next === null ? [] : [{ span, text: `#${next}` }];
  });

const frontmatterReplacements = (content: string, from: string, to: string): Replacement[] => {
  const yaml = frontmatterYaml(content);
  const start = frontmatterYamlStart(content);
  if (yaml === null || start === null) {
    return [];
  }
  return frontmatterTags(yaml).flatMap(({ entry, hashed, tag }) => {
    const next = renamedTag(tag, from, to);
    if (next === null) {
      return [];
    }
    return [
      {
        span: { end: start + entry.end, start: start + entry.start },
        text: yamlScalarText(hashed ? `#${next}` : next, entry.style),
      },
    ];
  });
};

export const renameTagsInDoc = (content: string, from: string, to: string): string => {
  const replacements = [
    ...frontmatterReplacements(content, from, to),
    ...inlineReplacements(content, from, to),
  ];
  // back-to-front so earlier spans stay valid; the frontmatter and the body never overlap
  let out = content;
  for (const { span, text } of replacements.toSorted((a, b) => b.span.start - a.span.start)) {
    out = out.slice(0, span.start) + text + out.slice(span.end);
  }
  return out;
};

// `docs` is keyed by path; the result holds changed docs only
export const computeTagRenameEdits = (
  docs: ReadonlyMap<string, string>,
  from: string,
  to: string,
): Map<string, string> => {
  const edits = new Map<string, string>();
  if (from === to) {
    return edits;
  }
  for (const [path, content] of docs) {
    const next = renameTagsInDoc(content, from, to);
    if (next !== content) {
      edits.set(path, next);
    }
  }
  return edits;
};
