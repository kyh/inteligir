// What a paste or a drop carries that the library can save, read from a DataTransfer and nothing
// else. Files win over links, since a dragged image carries its own url too. A link comes from
// the uri-list, its title from Firefox's moz-url pairs or the dragged anchor's text; failing
// both, plain text whose every line is a web link. A file over the cap and a folder are refused
// here, before any byte is sent, in the words every client says them in.

import { fileTooLargeMessage, ITEM_FILE_MAX_BYTES } from "@repo/notes/items/item-kind";
import { isWebUrl } from "@repo/notes/items/item-url";

export interface CapturedLink {
  readonly url: string;
  readonly title: string | null;
}

export interface CapturePayload {
  readonly files: File[];
  readonly urls: CapturedLink[];
  // one plain sentence per thing that was not taken
  readonly refused: string[];
}

// what a paste or a drop hands over, as much of a DataTransfer as is read here
export interface TransferLike {
  readonly files: Iterable<File>;
  readonly items: Iterable<{
    readonly kind: string;
    readonly getAsFile: () => File | null;
    readonly webkitGetAsEntry?: () => { readonly isDirectory: boolean } | null;
  }>;
  readonly getData: (format: string) => string;
}

type TransferItem = TransferLike["items"] extends Iterable<infer Item> ? Item : never;

export const MAX_PASTED_LINKS = 50;

export const FOLDER_REFUSAL = "Folders can't be saved; drop the files inside";

const EMPTY: CapturePayload = { files: [], refused: [], urls: [] };

export const isEmptyPayload = (payload: CapturePayload): boolean =>
  payload.files.length === 0 && payload.urls.length === 0 && payload.refused.length === 0;

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");

// a dropped directory reads as a file with no type; only its entry says it is a folder
const isFolderItem = (item: TransferItem): boolean =>
  item.kind === "file" && item.webkitGetAsEntry?.()?.isDirectory === true;

const filesOf = (dt: TransferLike) => {
  const files: File[] = [];
  const refused: string[] = [];
  const items = [...dt.items].filter((item) => item.kind === "file");
  const folders = new Set<string>();
  for (const item of items) {
    if (isFolderItem(item)) {
      const name = item.getAsFile()?.name;
      if (name !== undefined) {
        folders.add(name);
      }
    }
  }
  for (const file of dt.files) {
    if (folders.has(file.name)) {
      refused.push(FOLDER_REFUSAL);
    } else if (file.size > ITEM_FILE_MAX_BYTES) {
      refused.push(fileTooLargeMessage(file.name, file.size));
    } else {
      files.push(file);
    }
  }
  return { files, refused };
};

// Firefox's moz-url is url and title on alternate lines
const mozTitles = (dt: TransferLike): Map<string, string> => {
  const titles = new Map<string, string>();
  const raw = dt.getData("text/x-moz-url").split(/\r?\n/u);
  for (let at = 0; at + 1 < raw.length; at += 2) {
    const url = raw[at]?.trim() ?? "";
    const title = raw[at + 1]?.trim() ?? "";
    if (url !== "" && title !== "" && title !== url) {
      titles.set(url, title);
    }
  }
  return titles;
};

// the text of the dragged anchors, by href
const anchorTitles = (dt: TransferLike): Map<string, string> => {
  const titles = new Map<string, string>();
  const html = dt.getData("text/html");
  if (html === "") {
    return titles;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    const text = anchor.textContent?.replaceAll(/\s+/gu, " ").trim() ?? "";
    if (href !== "" && text !== "" && text !== href && !titles.has(href)) {
      titles.set(href, text);
    }
  }
  return titles;
};

const linksOf = (dt: TransferLike): CapturedLink[] => {
  const listed = lines(dt.getData("text/uri-list")).filter(
    (line) => !line.startsWith("#") && isWebUrl(line),
  );
  if (listed.length > 0) {
    const titles = new Map([...anchorTitles(dt), ...mozTitles(dt)]);
    return [...new Set(listed)]
      .slice(0, MAX_PASTED_LINKS)
      .map((url) => ({ title: titles.get(url) ?? null, url }));
  }
  const plain = lines(dt.getData("text/plain"));
  if (plain.length === 0 || !plain.every(isWebUrl)) {
    return [];
  }
  return [...new Set(plain)].slice(0, MAX_PASTED_LINKS).map((url) => ({ title: null, url }));
};

export const payloadFrom = (dt: TransferLike | null): CapturePayload => {
  if (dt === null) {
    return EMPTY;
  }
  const { files, refused } = filesOf(dt);
  if (files.length > 0 || refused.length > 0) {
    return { files, refused, urls: [] };
  }
  return { files: [], refused: [], urls: linksOf(dt) };
};

// what a file picker handed over: the cap applies as to a drop
export const filesPayload = (picked: readonly File[]): CapturePayload => {
  const files: File[] = [];
  const refused: string[] = [];
  for (const file of picked) {
    if (file.size > ITEM_FILE_MAX_BYTES) {
      refused.push(fileTooLargeMessage(file.name, file.size));
    } else {
      files.push(file);
    }
  }
  return { files, refused, urls: [] };
};
