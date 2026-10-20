// `inteligir items`: the library listing, one tab-separated line per item, as the grid's
// `knowledge.items` answers it.

import {
  KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
  KNOWLEDGE_ITEMS_MAX_LIMIT,
} from "@repo/contract/local/knowledge/knowledge-schema";
import type { KnowledgeItemsRequest } from "@repo/contract/local/knowledge/knowledge-schema";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { isItemKind } from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { parseItemTime } from "@repo/notes/items/item-time";
import { defineCommand } from "citty";
import { parseBoundedInteger } from "../args";
import { invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

// the sorts a listing with no query takes; relevance is a search's
const ITEMS_SORTS = ["saved", "modified", "title"] as const;

const parseKinds = (raw: string | undefined): ItemKind[] | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const kinds: ItemKind[] = [];
  for (const each of raw.split(",")) {
    const kind = each.trim();
    if (!isItemKind(kind)) {
      throw invalidUsage(
        `--kind ${kind} is not a kind; use note, link, video, audio, image, pdf or file`,
      );
    }
    if (!kinds.includes(kind)) {
      kinds.push(kind);
    }
  }
  return kinds;
};

const parseSince = (raw: string | undefined): string | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (parseItemTime(raw) === null) {
    throw invalidUsage(`--since ${raw} is not a date; write 2026-10-16 or 2026-10-16T09:00:00Z`);
  }
  return raw;
};

// path⇥kind⇥saved day⇥site⇥tags
const itemListingLine = (item: ItemRowWire): string =>
  [
    item.path,
    item.kind,
    item.saved?.slice(0, "YYYY-MM-DD".length) ?? "-",
    item.site ?? item.host ?? "-",
    item.tags.map((tag) => `#${tag}`).join(" "),
  ].join("\t");

export const itemsCommand = (deps: CliDeps) =>
  defineCommand({
    args: {
      flat: { description: "Only the folder itself, not its subfolders", type: "boolean" },
      folder: { description: "Only items in this folder (and below it)", type: "string" },
      kind: {
        description:
          "Only these kinds, comma-separated (note, link, video, audio, image, pdf, file)",
        type: "string",
      },
      limit: {
        description: `Page size (1–${KNOWLEDGE_ITEMS_MAX_LIMIT}, default ${KNOWLEDGE_ITEMS_DEFAULT_LIMIT})`,
        type: "string",
      },
      offset: { description: "Rows to skip, for the next page", type: "string" },
      since: { description: "Only items saved at or after this date", type: "string" },
      site: { description: "Only items from this site", type: "string" },
      sort: {
        description: "saved (default), modified or title; pinned items lead every sort",
        options: [...ITEMS_SORTS],
        type: "enum",
      },
      tag: {
        description: "Only items holding this tag or one under it, without the #",
        type: "string",
      },
      untagged: { description: "Only items with no tag at all", type: "boolean" },
      ...jsonArg,
    },
    meta: { description: "List the library's items, newest saved first", name: "items" },
    run: async ({ args }) => {
      if (args.untagged === true && args.tag !== undefined) {
        throw invalidUsage("--tag and --untagged cannot be asked together");
      }
      const offset =
        args.offset === undefined ? 0 : parseBoundedInteger(args.offset, "--offset", { min: 0 });
      const limit =
        args.limit === undefined
          ? KNOWLEDGE_ITEMS_DEFAULT_LIMIT
          : parseBoundedInteger(args.limit, "--limit", { max: KNOWLEDGE_ITEMS_MAX_LIMIT, min: 1 });
      const request: KnowledgeItemsRequest = {
        folder: args.folder,
        kinds: parseKinds(args.kind),
        limit,
        offset,
        since: parseSince(args.since),
        site: args.site,
        sort: args.sort,
        subfolders: args.flat !== true,
        tag: args.tag,
        untagged: args.untagged === true,
      };
      const body = await apiFor(deps).knowledge.items(request);
      if (outputJson(args, body)) {
        return;
      }
      if (body.total === 0) {
        out.info("No items.");
        return;
      }
      const shown = offset + body.items.length;
      writeLines([
        ...body.items.map(itemListingLine),
        ...(shown < body.total ? [`(${shown} of ${body.total}; more: --offset ${shown})`] : []),
      ]);
    },
  });
