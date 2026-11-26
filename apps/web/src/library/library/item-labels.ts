import type { Reading } from "@repo/contract/library/item-reading";
import { KIND_LABELS } from "@repo/client/library-labels";
import { URL_ITEM_KINDS } from "@repo/contract/items/item-kind";
import { urlHost } from "@repo/contract/items/item-url";
import { relativeTimeLabel } from "../relative-time";
import type { ListedItem } from "../cloud/library-queries";

export const coverOf = (row: ListedItem) =>
  row.fields.coverSha ?? (row.fields.kind === "image" ? row.fields.originalSha : null);

export const isUrlItem = (fields: Pick<ListedItem["fields"], "kind" | "url">) =>
  fields.url !== null && URL_ITEM_KINDS.some((kind) => kind === fields.kind);

export const readsPdfText = (
  fields: Pick<ListedItem["fields"], "deletedAt" | "kind" | "originalSha" | "url">,
) =>
  fields.kind === "pdf" &&
  fields.url === null &&
  fields.originalSha !== null &&
  fields.deletedAt === null;

export const fileExtensionLabel = (name: string | null) => {
  if (name === null) {
    return "";
  }

  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
};

const whereFrom = (row: ListedItem) =>
  row.fields.site ?? (row.fields.url === null ? null : urlHost(row.fields.url));

export const cardMeta = (row: ListedItem, nowMs: number) => {
  const parts: string[] = [];

  switch (row.fields.kind) {
    case "link":
    case "video":
    case "audio": {
      parts.push(whereFrom(row) ?? KIND_LABELS[row.fields.kind]);
      break;
    }

    case "folder":
    case "image":
    case "list":
    case "pdf":
    case "note": {
      parts.push(KIND_LABELS[row.fields.kind]);
      break;
    }

    case "file": {
      parts.push(fileExtensionLabel(row.fields.originalName) || KIND_LABELS.file);
      break;
    }

    default: {
      const exhaustive: never = row.fields.kind;

      return exhaustive;
    }
  }

  parts.push(
    relativeTimeLabel(row.fields.savedAt, nowMs, { inSentence: true }).replace(/ ago$/u, ""),
  );
  const tags = row.tags.slice(0, 3).map((tag) => `#${tag}`);

  if (tags.length > 0) {
    parts.push(tags.join(" "));
  }

  return parts.join(" · ");
};

export const readingNotice = (reading: Reading) => {
  switch (reading.state) {
    case "pending": {
      return "Not read yet. The page is read in the cloud, and its text appears here soon.";
    }

    case "failed": {
      return reading.error;
    }

    case "none":
    case "read": {
      return null;
    }

    default: {
      throw new Error(`unexpected ${String(reading satisfies never)}`);
    }
  }
};
