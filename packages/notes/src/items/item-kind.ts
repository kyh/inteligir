// What an item is, spelled once. Parser-free on purpose: the contract validates against these and
// loads in every client, so this module reaches only the path grammars, never yaml or remark.

import { DEFAULT_ATTACHMENTS_FOLDER } from "../knowledge/asset-name";
import { isDocPath, isDotEntryPath } from "../knowledge/doc-file";
import { extnamePath } from "../knowledge/folder-path";

export const ITEM_KINDS = ["note", "link", "video", "audio", "image", "pdf", "file"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const isItemKind = (value: string): value is ItemKind =>
  ITEM_KINDS.some((kind) => kind === value);

// the kinds whose identity is a url, so the only kinds a stub can be
export const URL_ITEM_KINDS = ["link", "video", "audio"] as const satisfies readonly ItemKind[];

// the frontmatter keys an item's facts live in, in the order a writer puts them (`id` before
// them, `tags` and `pinned` after); spelled here so a parser-free reader can name them
const ITEM_KEYS = [
  "kind",
  "url",
  "site",
  "author",
  "published",
  "saved",
  "fetched",
  "fetch-error",
  "description",
] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];

export type FileKind = "image" | "pdf" | "video" | "audio" | "file";

/** @internal */
export const FILE_KIND_EXTENSIONS = {
  audio: [".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav"],
  image: [
    ".apng",
    ".avif",
    ".bmp",
    ".gif",
    ".heic",
    ".ico",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".webp",
  ],
  pdf: [".pdf"],
  video: [".m4v", ".mov", ".mp4", ".webm"],
} as const satisfies Record<Exclude<FileKind, "file">, readonly string[]>;

const KIND_BY_EXTENSION = new Map<string, FileKind>([
  ...FILE_KIND_EXTENSIONS.audio.map((ext) => [ext, "audio"] as const),
  ...FILE_KIND_EXTENSIONS.image.map((ext) => [ext, "image"] as const),
  ...FILE_KIND_EXTENSIONS.pdf.map((ext) => [ext, "pdf"] as const),
  ...FILE_KIND_EXTENSIONS.video.map((ext) => [ext, "video"] as const),
]);

// null for a doc or a metadata path, neither of which is a file item; "file" for any other name
export const fileKindOf = (path: string): FileKind | null => {
  if (isDocPath(path) || isDotEntryPath(path)) {
    return null;
  }
  return KIND_BY_EXTENSION.get(extnamePath(path).toLowerCase()) ?? "file";
};

// what kind of file a type uploaded as is; a type no viewer reads is a plain file
export const fileKindOfMime = (mime: string): FileKind => {
  const type = mime.toLowerCase();
  if (type === "application/pdf") {
    return "pdf";
  }
  for (const kind of ["image", "video", "audio"] as const) {
    if (type.startsWith(`${kind}/`)) {
      return kind;
    }
  }
  return "file";
};

// the type a file is kept as when nothing that handled it could tell: plain bytes
export const UNKNOWN_FILE_TYPE = "application/octet-stream";

// a media type and the extensions a file of it goes by, the first the one it is written under
const MEDIA_EXTENSIONS: readonly (readonly [type: string, written: string, ...read: string[]])[] = [
  ["application/json", "json"],
  ["application/pdf", "pdf"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg", "oga", "opus"],
  ["audio/wav", "wav"],
  ["image/apng", "apng"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/jpeg", "jpg", "jpeg"],
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/webp", "webp"],
  ["image/x-icon", "ico"],
  ["text/html", "html"],
  ["text/markdown", "md"],
  ["text/plain", "txt"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["video/x-m4v", "m4v"],
];

const EXTENSION_OF_TYPE = new Map(
  MEDIA_EXTENSIONS.map(([type, written]) => [type, written] as const),
);

const TYPE_OF_EXTENSION = new Map(
  MEDIA_EXTENSIONS.flatMap(([type, ...extensions]) =>
    extensions.map((extension) => [extension, type] as const),
  ),
);

// a file's media type by the extension its name ends in, null for a name that says none
export const mediaTypeOfName = (name: string): string | null =>
  TYPE_OF_EXTENSION.get(extnamePath(name).slice(1).toLowerCase()) ?? null;

// the extension bytes of a media type are written under, its parameters aside
export const extensionOfMediaType = (mediaType: string): string | null =>
  EXTENSION_OF_TYPE.get(mediaType.split(";")[0]?.trim() ?? "") ?? null;

// the type a file the person hands over is kept as: the one it came with, else plain bytes (a
// browser gives "" for a file whose type it does not know, which the library takes for none)
export const keptFileType = (handed: string): string =>
  handed === "" ? UNKNOWN_FILE_TYPE : handed;

export const COVERS_DIR = "assets/covers";

const CONTENT_ADDRESS_HEX_CHARS = 16;

// a file kept by its bytes (a cover): named by the first hex of their SHA-256, so two devices
// keeping the same bytes write one file
export const contentAddressedName = (sha256Hex: string, extension: string): string =>
  `${sha256Hex.slice(0, CONTENT_ADDRESS_HEX_CHARS)}.${extension}`;

// a file an export cannot write under its own name in `assets/`, because another file holds that
// name or an import would read that path as a note or pass it over: a folder of its bytes, which
// an import reads as the file it is, whatever its name says
export const bytesFolderPath = (sha256Hex: string, name: string): string =>
  `${DEFAULT_ATTACHMENTS_FOLDER}/${sha256Hex.slice(0, CONTENT_ADDRESS_HEX_CHARS)}/${name}`;

const BYTES_FOLDER_PATH = new RegExp(
  `^${DEFAULT_ATTACHMENTS_FOLDER}/[0-9a-f]{${String(CONTENT_ADDRESS_HEX_CHARS)}}/[^/]+$`,
  "u",
);

export const isBytesFolderPath = (path: string): boolean => BYTES_FOLDER_PATH.test(path);

// the library's filing rules, which the agent reads; hidden from the grid
export const LIBRARY_RULES_PATH = "AGENTS.md";

// what a device says of a link it will not save, in the one sentence every device says it
export const WEB_URL_RULE = "Only web links (http or https) can be saved.";
