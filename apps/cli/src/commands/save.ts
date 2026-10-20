// `inteligir save` and `inteligir item refresh`: the two verbs that ask the Mac to read a page. Both
// are thin clients: the fetch, the fill and every rule about what a save writes are the server's.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { CAPTURE_HTML_MAX_CHARS } from "@repo/contract/browser/browser-wire";
import type { LocalClient } from "@repo/contract/local";
import {
  fileTooLargeMessage,
  itemSaveResponseSchema,
} from "@repo/contract/local/items/items-schema";
import type {
  ItemFill,
  ItemSaveResponse,
  ItemsRefreshResponse,
} from "@repo/contract/local/items/items-schema";
import { ITEM_FILE_MAX_BYTES } from "@repo/notes/items/item-kind";
import { isWebUrl } from "@repo/notes/items/item-url";
import { defineCommand } from "citty";
import { z } from "zod";
import { invalidUsage } from "../cli-error";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, outputJson, writeLines } from "../output";

// `save -`'s --json document: one answer per link, in stdin's order
export const saveStdinOutputSchema = z.strictObject({
  results: z.array(itemSaveResponseSchema),
});

const STDIN_LINKS_MAX_BYTES = 1024 * 1024;
const STDIN_LINKS_MAX = 50;
// a UTF-8 code unit takes at most three bytes, so this bounds the read before the decode counts it
const HTML_MAX_BYTES = CAPTURE_HTML_MAX_CHARS * 3;

type SaveTarget =
  | { kind: "stdin" }
  | { kind: "link"; url: string }
  | { kind: "file"; filePath: string; size: number };

// `fatal`: invalid UTF-8 is refused rather than turned into U+FFFD
const readStdinText = async (maxBytes: number, what: string): Promise<string> => {
  if (process.stdin.isTTY) {
    throw invalidUsage(`stdin is a terminal; pipe ${what} into it`);
  }
  const bytes = await buffer(process.stdin);
  if (bytes.byteLength > maxBytes) {
    throw invalidUsage(`stdin is ${bytes.byteLength} bytes; ${what} may be at most ${maxBytes}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidUsage("stdin is not valid UTF-8");
  }
};

// every non-empty line a web link, in order
const parseStdinLinks = (text: string): string[] => {
  const links: string[] = [];
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    if (!isWebUrl(line)) {
      throw invalidUsage(`line ${index + 1} of stdin is not a web link`);
    }
    links.push(line);
  }
  if (links.length === 0) {
    throw invalidUsage("stdin holds no web link");
  }
  if (links.length > STDIN_LINKS_MAX) {
    throw invalidUsage(
      `stdin holds ${links.length} web links; save at most ${STDIN_LINKS_MAX} at once`,
    );
  }
  return links;
};

const statOrNull = async (filePath: string) => {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
};

// `-`, then a web link, then a regular file on this Mac
const resolveTarget = async (target: string): Promise<SaveTarget> => {
  if (target === "-") {
    return { kind: "stdin" };
  }
  if (isWebUrl(target)) {
    return { kind: "link", url: target };
  }
  const found = await statOrNull(target);
  if (found?.isFile() === true) {
    return { filePath: target, kind: "file", size: found.size };
  }
  throw invalidUsage(`${target} is not a web link or a file on this Mac`);
};

const readHtml = async (source: string): Promise<string> => {
  if (source === "-") {
    return readStdinText(HTML_MAX_BYTES, "the page's HTML");
  }
  const found = await statOrNull(source);
  if (found?.isFile() !== true) {
    throw invalidUsage(`--html ${source} is not a file on this Mac`);
  }
  if (found.size > HTML_MAX_BYTES) {
    throw invalidUsage(
      `--html ${source} is ${found.size} bytes; a page may be at most ${HTML_MAX_BYTES}`,
    );
  }
  return readFile(source, "utf-8");
};

const assertHtmlWithinBound = (html: string): string => {
  if (html.length > CAPTURE_HTML_MAX_CHARS) {
    throw invalidUsage(`the page's HTML is over ${CAPTURE_HTML_MAX_CHARS} characters`);
  }
  return html;
};

// a comma list of tag names, each spelled without the #
const parseTags = (raw: string | undefined): string[] | undefined =>
  raw === undefined
    ? undefined
    : raw
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

const describeFillAfter = (lead: string, fill: ItemFill): string => {
  if (fill.state === "failed") {
    return `${lead}, but its page couldn't be read: ${fill.message}`;
  }
  return fill.state === "pending" ? `${lead}; its page is still being read` : lead;
};

const describeSave = (saved: ItemSaveResponse): string =>
  saved.outcome === "exists"
    ? `Already saved: ${saved.path}`
    : describeFillAfter(`Saved ${saved.path}`, saved.fill);

const describeRefresh = (refreshed: ItemsRefreshResponse): string =>
  describeFillAfter(`Refreshed ${refreshed.path}`, refreshed.fill);

interface SaveFlags {
  folder: string | undefined;
  keepCopy: boolean;
  tags: string[] | undefined;
  wait: boolean;
}

const saveLinks = async (api: LocalClient, urls: readonly string[], flags: SaveFlags) => {
  const results: ItemSaveResponse[] = [];
  for (const url of urls) {
    results.push(await api.items.saveLink({ ...flags, url }));
  }
  return results;
};

export const saveCommand = (deps: CliDeps) =>
  defineCommand({
    args: {
      target: {
        description: "A web link, a file on this Mac, or - for web links on stdin, one per line",
        required: true,
        type: "positional",
      },
      copy: { description: "Keep a copy of the page (web links only)", type: "boolean" },
      folder: { description: "The folder to save into (default: Unsorted)", type: "string" },
      html: {
        description: "The page's HTML from a file (or - for stdin), instead of fetching it",
        type: "string",
      },
      tags: { description: "Tags to add, comma-separated, each without the #", type: "string" },
      wait: {
        default: true,
        description: "Wait until the page is read (--no-wait answers at once)",
        type: "boolean",
      },
      ...jsonArg,
    },
    meta: { description: "Save a web link or a file into the library", name: "save" },
    run: async ({ args }) => {
      const target = await resolveTarget(args.target);
      if (target.kind === "file" && (args.copy === true || args.html !== undefined)) {
        throw invalidUsage("--copy and --html are for a web link, not a file");
      }
      if (target.kind === "stdin" && args.html !== undefined) {
        throw invalidUsage("--html takes the page of one web link, not of links on stdin");
      }
      const flags: SaveFlags = {
        folder: args.folder,
        keepCopy: args.copy === true,
        tags: parseTags(args.tags),
        wait: args.wait,
      };
      if (target.kind === "stdin") {
        const urls = parseStdinLinks(await readStdinText(STDIN_LINKS_MAX_BYTES, "web links"));
        const results = await saveLinks(apiFor(deps), urls, flags);
        if (outputJson(args, { results })) {
          return;
        }
        writeLines(results.map(describeSave));
        return;
      }
      let saved: ItemSaveResponse;
      if (target.kind === "file") {
        const name = path.basename(target.filePath);
        if (target.size > ITEM_FILE_MAX_BYTES) {
          throw invalidUsage(fileTooLargeMessage(name, target.size));
        }
        const bytes = await readFile(target.filePath);
        saved = await apiFor(deps).items.saveFile({
          file: new Blob([new Uint8Array(bytes)]),
          folder: flags.folder,
          name,
          tags: flags.tags,
        });
      } else if (args.html === undefined) {
        saved = await apiFor(deps).items.saveLink({ ...flags, url: target.url });
      } else {
        const html = assertHtmlWithinBound(await readHtml(args.html));
        saved = await apiFor(deps).items.savePage({
          ...flags,
          page: { html, selection: null, title: "", url: target.url },
        });
      }
      if (outputJson(args, saved)) {
        return;
      }
      writeLines([describeSave(saved)]);
    },
  });

// `item refresh` lives beside `save`: the same fill answers both
export const itemRefreshCommand = (deps: CliDeps) =>
  defineCommand({
    args: {
      path: {
        description: "The saved link's path in the library",
        required: true,
        type: "positional",
      },
      copy: { description: "Keep a copy of the page too", type: "boolean" },
      "replace-text": {
        description: "Replace the item's text with the page's (refused while it has highlights)",
        type: "boolean",
      },
      wait: {
        default: true,
        description: "Wait until the page is read (--no-wait answers at once)",
        type: "boolean",
      },
      ...jsonArg,
    },
    meta: { description: "Read a saved link's page again", name: "refresh" },
    run: async ({ args }) => {
      const body = await apiFor(deps).items.refresh({
        keepCopy: args.copy === true,
        path: args.path,
        text: args["replace-text"] === true ? "replace" : "keep",
        wait: args.wait,
      });
      if (outputJson(args, body)) {
        return;
      }
      writeLines([describeRefresh(body)]);
    },
  });
