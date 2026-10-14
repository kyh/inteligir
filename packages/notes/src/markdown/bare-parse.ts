// the editor's grammar as a bare `parse`: no transformer runs, so wiki links, math and html tags
// (paired as the editor pairs them) sit where they were written, pills, dates, comment markers and
// `:::` markers are still text, nothing is opaque yet, and every offset names the source's bytes
// (the pill-pipe pre-pass is skipped, since it shifts columns). The knowledge scan reads this tree, so the index and a rename read a note as
// the editor does.

import type { Root } from "mdast";

import { MD_PROCESSOR } from "./md-plugins";
import { rebaseParsedOffsets } from "./parsed-offsets";

export const parseBare = (source: string): Root => {
  const tree = MD_PROCESSOR.parse(source);
  rebaseParsedOffsets(tree, source);
  return tree;
};
