// The line under a Library row's title: where the cloud's read of a link stands while it is not
// read, else the site and the day it was saved.

import type { LibraryItemFields } from "@repo/notes/library/library-item";

// a link the cloud has not read yet: its title and cover come with that read
const PENDING_LINE = "Waiting to be read";

// a link the cloud tried and could not read, in the Mac's and the web's words
const FAILED_LINE = "Page not read";

export const cardCaption = (row: {
  readonly fields: Pick<LibraryItemFields, "fetchState" | "site">;
  readonly savedAt: number;
}): string => {
  if (row.fields.fetchState === "pending") {
    return PENDING_LINE;
  }
  if (row.fields.fetchState === "failed") {
    return FAILED_LINE;
  }
  return [row.fields.site, new Date(row.savedAt).toLocaleDateString()]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
};
