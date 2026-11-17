// The library's rows under `/v1/rpc`: the reading side's and the writing side's, merged where both
// route a row under `items`.

import { libraryReadRows } from "../library/library-read-rows";
import { libraryWriteRows } from "../library/library-write-rows";

export const libraryRouter = {
  ...libraryReadRows,
  ...libraryWriteRows,
  items: { ...libraryReadRows.items, ...libraryWriteRows.items },
};
