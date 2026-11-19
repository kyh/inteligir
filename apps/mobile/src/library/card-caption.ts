import type { LibraryItemFields } from "@repo/contract/library/library-item";

const PENDING_LINE = "Waiting to be read";

const FAILED_LINE = "Page not read";

export const cardCaption = (row: {
  readonly fields: Pick<LibraryItemFields, "reading" | "savedAt" | "site">;
}) => {
  const { state } = row.fields.reading;

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
