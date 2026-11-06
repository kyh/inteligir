// What an item is, spelled once. Parser-free on purpose: the contract validates against these and
// loads in every client, so this module reaches only the path grammars, never yaml or remark.

import { isDocPath, isVaultMetadataPath } from "../knowledge/doc-file";
import { extnamePath } from "../knowledge/vault-path";

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

// wider than the servable media table: `.heic` is an image item the asset route does not serve
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
  if (isDocPath(path) || isVaultMetadataPath(path)) {
    return null;
  }
  return KIND_BY_EXTENSION.get(extnamePath(path).toLowerCase()) ?? "file";
};

export const UNSORTED_FOLDER = "Unsorted";
export const COVERS_DIR = "assets/covers";
export const PAGES_DIR = "assets/pages";

const CONTENT_ADDRESS_HEX_CHARS = 16;

// a file kept by its bytes (a cover, a page copy): named by the first hex of their SHA-256, so two
// devices keeping the same bytes write one file
export const contentAddressedName = (sha256Hex: string, extension: string): string =>
  `${sha256Hex.slice(0, CONTENT_ADDRESS_HEX_CHARS)}.${extension}`;

// the library's filing rules, which the agent reads; hidden from the grid
export const LIBRARY_RULES_PATH = "AGENTS.md";

// what a device says of a link it will not save, in the one sentence every device says it
export const WEB_URL_RULE = "Only web links (http or https) can be saved.";
