// The line under a Library row's title: where the cloud's read of a link stands while it is not
// read, else the site and the day it was saved.

import { readingOf } from "@repo/contract/library/item-reading";
import type { LibraryItemFields } from "@repo/contract/library/library-item";

// a link the cloud has not read yet: its title and cover come with that read
const PENDING_LINE = "Waiting to be read";

// a link the cloud tried and could not read, in the Mac's and the web's words
const FAILED_LINE = "Page not read";

export const cardCaption = (row: {
  readonly fields: Pick<
    LibraryItemFields,
    "fetchError" | "fetchState" | "fetchedAt" | "savedAt" | "site"
  >;
}): string => {
  const { state } = readingOf(row.fields);
  if (state === "pending") {
    return PENDING_LINE;
  }
  if (state === "failed") {
    return FAILED_LINE;
  }
  return [row.fields.site, new Date(row.fields.savedAt).toLocaleDateString()]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
};
