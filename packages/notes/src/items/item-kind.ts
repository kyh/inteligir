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

// the largest file the library takes; equal to the hosted library's VAULT_ASSET_MAX_BYTES, which
// a contract test holds
export const ITEM_FILE_MAX_BYTES = 10 * 1024 * 1024;

export const UNSORTED_FOLDER = "Unsorted";
export const COVERS_DIR = "assets/covers";
export const PAGES_DIR = "assets/pages";

// the library's filing rules, which the agent reads; hidden from the grid
export const LIBRARY_RULES_PATH = "AGENTS.md";

// The refusal sentences every client says, spelled here because the phone reaches no
// @repo/contract/local module; the local contract re-exports both.
export const WEB_URL_RULE = "Only web links (http or https) can be saved.";

const BYTES_PER_MB = 1024 * 1024;

const wholeMegabytes = (bytes: number): number => Math.max(1, Math.round(bytes / BYTES_PER_MB));

export const fileTooLargeMessage = (name: string, bytes: number): string =>
  `“${name}” is ${String(wholeMegabytes(bytes))} MB. inteligir keeps files up to ${String(
    wholeMegabytes(ITEM_FILE_MAX_BYTES),
  )} MB.`;
