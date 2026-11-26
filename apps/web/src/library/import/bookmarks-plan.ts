import { isWebUrl } from "@repo/contract/items/item-url";

import type { RaindropRow } from "./raindrop-plan";

type BookmarksParse =
  | { ok: true; rows: RaindropRow[]; skipped: number }
  | { ok: false; reason: "not-bookmarks" | "empty" };

const TOKEN = /<(?<slash>\/?)(?<tag>dl|h3|a|dd|dt)\b(?<source>[^>]*)>|(?<text>[^<]+)/giu;

const ATTRIBUTE =
  /(?<name>[\w-]+)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+))/gu;

const ENTITY = /&(?<name>#x[\da-f]+|#\d+|[a-z]+);/giu;

const DOCTYPE = /<!doctype\s+netscape-bookmark-file-1>/iu;

const ROOTS: ReadonlySet<string> = new Set([
  "bookmarks",
  "bookmarks bar",
  "bookmarks menu",
  "bookmarks toolbar",
  "bookmarksbar",
  "favorites",
  "favourites",
  "mobile bookmarks",
  "other bookmarks",
]);

const ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

const CODE_POINT_MAX = 0x10_ff_ff;

const codePointOf = (name: string) =>
  name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));

const decoded = (text: string) =>
  text.replaceAll(ENTITY, (whole, name: string) => {
    if (!name.startsWith("#")) {
      return ENTITIES.get(name.toLowerCase()) ?? whole;
    }

    const point = codePointOf(name);

    return Number.isInteger(point) && point > 0 && point <= CODE_POINT_MAX
      ? String.fromCodePoint(point)
      : whole;
  });

const attributesOf = (source: string) => {
  const attributes = new Map<string, string>();

  for (const { groups } of source.matchAll(ATTRIBUTE)) {
    const value = groups?.double ?? groups?.single ?? groups?.bare ?? "";
    attributes.set((groups?.name ?? "").toLowerCase(), decoded(value));
  }

  return attributes;
};

const textOf = (raw: string) => decoded(raw).replaceAll(/\s+/gu, " ").trim();

type OpenKind = "a" | "h3" | "dd";

const openKindOf = (tag: string) => {
  if (tag === "a" || tag === "h3") {
    return tag satisfies OpenKind;
  }

  return "dd" satisfies OpenKind;
};

interface Open {
  readonly kind: OpenKind;
  readonly attributes: Map<string, string>;
  text: string;
}

const isBrowserRoot = (name: string, depth: number, attributes: Map<string, string>) =>
  depth === 1 &&
  (attributes.get("personal_toolbar_folder") === "true" ||
    attributes.get("unfiled_bookmarks_folder") === "true" ||
    ROOTS.has(name.toLowerCase()));

const linkRow = (held: Open, folders: readonly (string | null)[]) => {
  const url = (held.attributes.get("href") ?? "").trim();

  if (!isWebUrl(url)) {
    return null;
  }

  const added = held.attributes.get("add_date") ?? "";

  return {
    cover: null,
    created: /^\d+$/u.test(added) ? added : null,
    excerpt: "",
    favorite: false,
    folder: folders.flatMap((name) => (name === null ? [] : [name])),
    highlights: [],
    note: "",
    tags: (held.attributes.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ""),
    title: textOf(held.text),
    url,
  } satisfies RaindropRow;
};

class BookmarksReader {
  readonly rows: RaindropRow[] = [];
  skipped = 0;
  seen = 0;
  private readonly folders: (string | null)[] = [];
  private pendingFolder: string | null = null;
  private open: Open | null = null;
  private lastLink = false;

  text(text: string) {
    if (this.open !== null) {
      this.open.text += text;
    }
  }

  tag(tag: string, closing: boolean, source: string) {
    if (tag === "dl") {
      this.close();
      this.list(closing);
    } else if (tag === "dt") {
      this.close();
    } else if (!closing) {
      this.close();
      this.open = { attributes: attributesOf(source), kind: openKindOf(tag), text: "" };
    } else if (this.open?.kind === tag) {
      this.close();
    }
  }

  close() {
    const held = this.open;
    this.open = null;

    if (held?.kind === "h3") {
      const name = textOf(held.text);
      this.lastLink = false;
      this.pendingFolder = isBrowserRoot(name, this.folders.length, held.attributes) ? null : name;
    } else if (held?.kind === "dd") {
      this.describe(textOf(held.text));
    } else if (held?.kind === "a") {
      this.link(held);
    }
  }

  private list(closing: boolean) {
    if (closing) {
      this.folders.pop();
    } else {
      this.folders.push(this.pendingFolder);
      this.pendingFolder = null;
    }
  }

  private describe(text: string) {
    const last = this.rows.at(-1);

    if (this.lastLink && last !== undefined && last.excerpt === "") {
      last.excerpt = text;
    }
  }

  private link(held: Open) {
    this.seen += 1;
    const row = linkRow(held, this.folders);
    this.lastLink = row !== null;

    if (row === null) {
      this.skipped += 1;
    } else {
      this.rows.push(row);
    }
  }
}

export const parseBookmarksHtml = (html: string) => {
  if (!DOCTYPE.test(html) && !/<dl\b/iu.test(html)) {
    return { ok: false, reason: "not-bookmarks" } satisfies BookmarksParse;
  }

  const reader = new BookmarksReader();

  for (const { groups } of html.matchAll(TOKEN)) {
    if (groups?.text === undefined) {
      reader.tag((groups?.tag ?? "").toLowerCase(), groups?.slash === "/", groups?.source ?? "");
    } else {
      reader.text(groups.text);
    }
  }

  reader.close();

  return reader.seen === 0
    ? ({ ok: false, reason: "empty" } satisfies BookmarksParse)
    : ({ ok: true, rows: reader.rows, skipped: reader.skipped } satisfies BookmarksParse);
};
