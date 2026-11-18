import { BLOB_MAX_BYTES } from "@repo/contract/library/library-blobs";
import { isWebUrl } from "@repo/contract/items/item-url";

export interface CapturedLink {
  readonly url: string;
  readonly title: string | null;
}

export interface CapturePayload {
  readonly files: File[];
  readonly urls: CapturedLink[];
  readonly refused: string[];
}

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

const MB = 1024 * 1024;

const tooLargeSentence = (name: string) =>
  `“${name}” is larger than ${String(BLOB_MAX_BYTES / MB)} MB, the most one file can be.`;

const EMPTY: CapturePayload = { files: [], refused: [], urls: [] };

export const isEmptyPayload = (payload: CapturePayload) =>
  payload.files.length === 0 && payload.urls.length === 0 && payload.refused.length === 0;

const lines = (text: string) =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const isFolderItem = (item: TransferItem) =>
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
    } else if (file.size > BLOB_MAX_BYTES) {
      refused.push(tooLargeSentence(file.name));
    } else {
      files.push(file);
    }
  }

  return { files, refused };
};

const mozTitles = (dt: TransferLike) => {
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

const anchorTitles = (dt: TransferLike) => {
  const titles = new Map<string, string>();
  const html = dt.getData("text/html");

  if (html === "") {
    return titles;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    const text = anchor.textContent.replaceAll(/\s+/gu, " ").trim();

    if (href !== "" && text !== "" && text !== href && !titles.has(href)) {
      titles.set(href, text);
    }
  }

  return titles;
};

const linksOf = (dt: TransferLike) => {
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
    return [] satisfies CapturedLink[];
  }

  return [...new Set(plain)].slice(0, MAX_PASTED_LINKS).map((url) => ({ title: null, url }));
};

export const payloadFrom = (dt: TransferLike | null) => {
  if (dt === null) {
    return EMPTY;
  }

  const { files, refused } = filesOf(dt);

  if (files.length > 0 || refused.length > 0) {
    return { files, refused, urls: [] } satisfies CapturePayload;
  }

  return { files: [], refused: [], urls: linksOf(dt) } satisfies CapturePayload;
};

export const filesPayload = (picked: readonly File[]) => {
  const files: File[] = [];
  const refused: string[] = [];

  for (const file of picked) {
    if (file.size > BLOB_MAX_BYTES) {
      refused.push(tooLargeSentence(file.name));
    } else {
      files.push(file);
    }
  }

  return { files, refused, urls: [] } satisfies CapturePayload;
};
