// What a doc's fts row holds: the literal columns and their stem shadows. Apart from the store
// because the stemming is CPU the synchronous sql binding need not wait on, so a host can
// compute it where it projects.

import type { DocProjection } from "./projection";
import { stemText } from "./search-query";

export interface DocSearchColumns {
  title: string;
  headings: string;
  body: string;
  titleStems: string;
  headingStems: string;
  bodyStems: string;
}

export const docSearchColumns = (projection: DocProjection, body: string): DocSearchColumns => {
  // aliases ride the headings column as a ranking boost; knowledge-index's setDoc must match
  const headings = [...projection.headings, ...projection.aliases].join("\n");
  return {
    body,
    bodyStems: stemText(body),
    headingStems: stemText(headings),
    headings,
    title: projection.title,
    titleStems: stemText(projection.title),
  };
};
