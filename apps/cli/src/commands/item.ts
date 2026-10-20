// `inteligir item show|find|refresh`: one item at a time. `refresh` is spelled beside `save`, which
// reads pages the same way.

import { itemRowSchema } from "@repo/contract/local/items/items-schema";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { isWebUrl } from "@repo/notes/items/item-url";
import { defineCommand } from "citty";
import { z } from "zod";
import { CliExitError, invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";
import { itemRefreshCommand } from "./save";

// `item show`'s --json document
export const itemShowOutputSchema = z.strictObject({ item: itemRowSchema });

// the facts a person asks about an item, in Info's order; a fact it does not have is left out
const itemFacts = (item: ItemRowWire): string[] => {
  const facts: readonly (readonly [string, string | null])[] = [
    ["kind", item.kind],
    ["url", item.url],
    ["site", item.site],
    ["author", item.author],
    ["published", item.published],
    ["saved", item.saved],
    ["fetched", item.fetched],
    ["fetch-error", item.fetchError],
    ["folder", item.folder === "" ? "/" : item.folder],
    ["cover", item.cover],
    ["file", item.file],
    ["copy", item.copy],
    ["tags", item.tags.length === 0 ? null : item.tags.map((tag) => `#${tag}`).join(" ")],
    ["pinned", item.pinned ? "yes" : null],
  ];
  return facts.flatMap(([key, value]) => (value === null ? [] : [`${key}: ${value}`]));
};

export const itemCommand = (deps: CliDeps) =>
  defineCommand({
    meta: {
      description: "One item: what it is, where a link is saved, reading it again",
      name: "item",
    },
    subCommands: {
      find: defineCommand({
        args: {
          url: { description: "The web link", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Where the library already holds a web link", name: "find" },
        run: async ({ args }) => {
          if (!isWebUrl(args.url)) {
            throw invalidUsage(`${args.url} is not a web link`);
          }
          const body = await apiFor(deps).knowledge.findByUrl({ url: args.url });
          if (outputJson(args, body)) {
            return;
          }
          if (body.items.length === 0) {
            out.info("Not saved yet");
            return;
          }
          writeLines(body.items.map((item) => item.path));
        },
      }),

      refresh: itemRefreshCommand(deps),

      show: defineCommand({
        args: {
          path: {
            description: "The item's path in the library",
            required: true,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: {
          description: "An item's facts: its kind, link, dates, files and tags",
          name: "show",
        },
        run: async ({ args }) => {
          const body = await apiFor(deps).knowledge.itemsAt({ paths: [args.path] });
          const [item] = body.items;
          if (item === undefined) {
            throw new CliExitError(`${args.path} is not an item`, { code: "NOT_FOUND" });
          }
          if (outputJson(args, { item })) {
            return;
          }
          writeLines(itemFacts(item));
        },
      }),
    },
  });
