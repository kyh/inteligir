// What a doc's fts row holds: the literal columns and their stem shadows. Apart from the store
// because the stemming is CPU the synchronous sql binding need not wait on, so a host can
// compute it where it projects.

import { frontmatterEnd } from "../markdown/frontmatter";
import { urlSearchText } from "../items/item-url";
import { projectDoc } from "./projection";
import type { DocProjection } from "./projection";
import type { SearchFields } from "./search-index";
import { stemText } from "./search-query";

export interface DocSearchColumns {
  title: string;
  headings: string;
  meta: string;
  body: string;
  titleStems: string;
  headingStems: string;
  metaStems: string;
  bodyStems: string;
}

const LINE_TERMINATOR = /\r\n|\r|\n/gu;

// the text both engines search: the doc with its frontmatter block replaced by one line break per
// line it held, so neither reads yaml and a match's line is still the file's line
export const searchBodyOf = (content: string): string => {
  const end = frontmatterEnd(content);
  if (end === null) {
    return content;
  }
  const breaks = content.slice(0, end).match(LINE_TERMINATOR)?.length ?? 0;
  return `${"\n".repeat(breaks)}${content.slice(end)}`;
};

// an item's properties the ranked index reads, one per line: where it is from and who wrote it,
// what it says it is, and its tags
const metaOf = (projection: DocProjection): string => {
  const { item } = projection;
  return [
    item.url === null ? "" : urlSearchText(item.url),
    item.site,
    item.author,
    item.description,
    ...projection.tags,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join("\n");
};

// what both engines index a doc under; aliases ride the headings as a ranking boost. `body` is
// searchBodyOf's text
export const searchFieldsOf = (projection: DocProjection, body: string): SearchFields => ({
  body,
  headings: [...projection.headings, ...projection.aliases],
  meta: metaOf(projection),
  title: projection.title,
});

export const docSearchColumns = (projection: DocProjection, body: string): DocSearchColumns => {
  const fields = searchFieldsOf(projection, body);
  const headings = fields.headings.join("\n");
  return {
    body: fields.body,
    bodyStems: stemText(fields.body),
    headingStems: stemText(headings),
    headings,
    meta: fields.meta,
    metaStems: stemText(fields.meta),
    title: fields.title,
    titleStems: stemText(fields.title),
  };
};

export interface IndexedDoc {
  projection: DocProjection;
  search: DocSearchColumns;
}

// the one projection every index takes: the worker's, the in-memory index's and the suites'
export const projectForIndex = (path: string, content: string): IndexedDoc => {
  const projection = projectDoc(path, content);
  return { projection, search: docSearchColumns(projection, searchBodyOf(content)) };
};
