import { DEFAULT_ATTACHMENTS_FOLDER } from "../knowledge/asset-name";
import { isDocPath, isDotEntryPath } from "../knowledge/doc-file";
import { extnamePath } from "../knowledge/folder-path";

export const ITEM_KINDS = ["note", "link", "video", "audio", "image", "pdf", "file"] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export const isItemKind = (value: string): value is ItemKind =>
  ITEM_KINDS.some((kind) => kind === value);

export const URL_ITEM_KINDS = ["link", "video", "audio"] as const satisfies readonly ItemKind[];

export type FileKind = "image" | "pdf" | "video" | "audio" | "file";

export const fileKindOfMime = (mime: string) => {
  const type = mime.toLowerCase();

  if (type === "application/pdf") {
    return "pdf" satisfies FileKind;
  }

  for (const kind of ["image", "video", "audio"] as const) {
    if (type.startsWith(`${kind}/`)) {
      return kind satisfies FileKind;
    }
  }

  return "file" satisfies FileKind;
};

export const UNKNOWN_FILE_TYPE = "application/octet-stream";

const MEDIA_EXTENSIONS: readonly (readonly [type: string, ...extensions: string[]])[] = [
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

const TYPE_OF_EXTENSION = new Map(
  MEDIA_EXTENSIONS.flatMap(([type, ...extensions]) =>
    extensions.map((extension) => [extension, type] as const),
  ),
);

export const mediaTypeOfName = (name: string) =>
  (TYPE_OF_EXTENSION.get(extnamePath(name).slice(1).toLowerCase()) ?? null) satisfies string | null;

export const extensionsOfType = (type: string) =>
  (MEDIA_EXTENSIONS.find(([known]) => known === type)?.slice(1) ?? []) satisfies readonly string[];

export const fileKindOf = (path: string) => {
  if (isDocPath(path) || isDotEntryPath(path)) {
    return null satisfies FileKind | null;
  }

  const type = mediaTypeOfName(path);

  return (type === null ? "file" : fileKindOfMime(type)) satisfies FileKind | null;
};

export const keptFileType = (handed: string) =>
  (handed === "" ? UNKNOWN_FILE_TYPE : handed) satisfies string;

export const COVERS_DIR = "assets/covers";

const CONTENT_ADDRESS_HEX_CHARS = 16;

const BYTES_FOLDER_PATH = new RegExp(
  `^${DEFAULT_ATTACHMENTS_FOLDER}/[0-9a-f]{${String(CONTENT_ADDRESS_HEX_CHARS)}}/[^/]+$`,
  "u",
);

export const isBytesFolderPath = (path: string) => BYTES_FOLDER_PATH.test(path) satisfies boolean;

export const bytesFolderPath = (sha: string, name: string) =>
  `${DEFAULT_ATTACHMENTS_FOLDER}/${sha.slice(0, CONTENT_ADDRESS_HEX_CHARS)}/${name}` satisfies string;

export const WEB_URL_RULE = "Only web links (http or https) can be saved.";
