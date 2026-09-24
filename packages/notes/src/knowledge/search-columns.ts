// What a doc's fts row holds: the literal columns and their stem shadows. Apart from the store
// because the stemming is CPU the synchronous sql binding need not wait on, so a host can
// compute it where it projects.

import type { DocProjection } from "./projection";
import type { SearchFields } from "./search-index";
import { stemText } from "./search-query";

export interface DocSearchColumns {
  title: string;
  headings: string;
  body: string;
  titleStems: string;
  headingStems: string;
  bodyStems: string;
}

// what both engines index a doc under; aliases ride the headings as a ranking boost
export const searchFieldsOf = (projection: DocProjection, body: string): SearchFields => ({
  body,
  headings: [...projection.headings, ...projection.aliases],
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
    title: fields.title,
    titleStems: stemText(fields.title),
  };
};
