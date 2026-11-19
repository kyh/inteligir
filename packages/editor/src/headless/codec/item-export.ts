// One item as the file an export writes, the inverse of an import's reading (`item-markdown.ts`),
// so a zip of them reads back into the same library. Its fields are the frontmatter
// (`writeFrontmatter`), its body the dialect with the page a fill read inside `:::article` after
// the note, and its path its folders' names and its title's, each one a disk takes, told apart
// from every path the export wrote before it. Each file it holds sits in the folder of its bytes
// under `assets/` (a cover under `assets/covers/`), as the body's first embed for a cover and
// the next for a file item's original, named as the item names it with an extension of the
// type its bytes are kept as, since an import reads a file's kind and type off its name. An item
// link is written by its item's id, which that item's file carries as `id:`.

import type { TElement } from "platejs";

import {
  bytesFolderPath,
  COVERS_DIR,
  extensionsOfType,
  mediaTypeOfName,
} from "@repo/contract/items/item-kind";
import { itemNameFromTitle, itemNameFromUrl, UNTITLED } from "@repo/contract/items/item-name";
import { docStem, isOsLitterPath } from "@repo/contract/knowledge/doc-file";
import {
  dirnamePath,
  extnamePath,
  joinPath,
  relativePath,
} from "@repo/contract/knowledge/folder-path";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { collectFileShas } from "@repo/contract/library/library-nodes";
import type { LibrarySection } from "@repo/contract/library/library-nodes";
import { headlessEditor, serializeNote } from "@repo/editor/headless/markdown/markdown-doc";
import { ARTICLE_SECTION_KEY } from "@repo/editor/headless/markdown/md-rules";

import { writeFrontmatter } from "./item-fields";
import { mdLinkUrl } from "./link-extract";
import { leaf } from "./slate-leaves";
import { writeBlocks } from "./write-blocks";
import type { WritePorts, WrittenFile } from "./write-blocks";

export interface ExportItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  // in reading order
  readonly blocks: readonly BodyBlock[];
  // the names of the folders it is filed in, from the top; none for an item filed nowhere
  readonly folder: readonly string[];
}

export interface ExportPorts {
  // an item's title as a link to it is written; null for one the export does not hold, whose link
  // keeps the title it saw and reads back as those words
  readonly title: (itemId: string) => string | null;
  // the media type a file's bytes are kept as, by its sha, as `/v1/blobs/<sha>` answers it
  readonly typeOf: (sha: string) => string;
}

// bytes the library holds, and where the export writes them
interface ExportedBytes {
  readonly sha: string;
  readonly path: string;
}

export interface ExportedFile {
  readonly path: string;
  readonly text: string;
  // each file the text names, in the order it names them, once a path; a path is the same for
  // the same bytes under the same name, so an export writes each path once
  readonly files: readonly ExportedBytes[];
  // the properties its frontmatter could not spell
  readonly leftOut: number;
}

// every file an item holds, each once: its cover, its original and those its body embeds, which an
// export learns the type of before it writes the item
export const heldShas = ({
  blocks,
  fields,
}: {
  readonly blocks: readonly BodyBlock[];
  readonly fields: Pick<LibraryItemFields, "coverSha" | "originalSha">;
}): string[] => {
  const shas = new Set<string>();
  for (const sha of [fields.coverSha, fields.originalSha]) {
    if (sha !== null) {
      shas.add(sha);
    }
  }
  for (const { block } of blocks) {
    collectFileShas(block, shas);
  }
  return [...shas];
};

// what a file the item gives no name goes by, by the block that holds it
const BLOCK_FILE_NAMES = {
  file: "File",
  img: "Image",
  video: "Video",
} as const satisfies Record<WrittenFile["node"], string>;

// an extension a disk and an import read as one
const PLAIN_EXTENSION = /^\.[A-Za-z0-9]{1,10}$/u;

const bareType = (type: string): string => (type.split(";")[0] ?? "").trim().toLowerCase();

// a file's name a disk takes, ending in an extension of its bytes' type wherever the type has one
const fileName = (name: string, type: string): string => {
  const written = extnamePath(name);
  const extension = PLAIN_EXTENSION.test(written) ? written : "";
  const stem = itemNameFromTitle(name.slice(0, name.length - extension.length)) ?? "File";
  const kept = bareType(type);
  const [typed] = extensionsOfType(kept);
  const named = `${stem}${extension}`;
  return typed === undefined || mediaTypeOfName(named) === kept ? named : `${named}.${typed}`;
};

// a folder's name a disk takes; an import passes over an operating system's folders and every
// item in them, so a person's folder of that name is told from theirs
const folderName = (name: string): string => {
  const written = itemNameFromTitle(name) ?? "Folder";
  return isOsLitterPath(written) ? `${written} (folder)` : written;
};

// the name an item's file goes by: its title, else the name its card shows
const itemName = (fields: LibraryItemFields): string =>
  itemNameFromTitle(fields.title) ?? (fields.url === null ? UNTITLED : itemNameFromUrl(fields.url));

const heldImage = (url: string): TElement => ({
  caption: [leaf("", {})],
  children: [leaf("", {})],
  type: "img",
  url,
});

interface WrittenBody {
  readonly markdown: string;
  readonly files: readonly ExportedBytes[];
}

// the item's body as its file holds it: the files it holds whole first, as an import takes them
// back, then the note, then the page inside `:::article`
const writeBody = (item: ExportItem, path: string, ports: ExportPorts): WrittenBody => {
  const { fields } = item;
  const files = new Map<string, string>();
  const from = dirnamePath(path);
  const named = (sha: string, at: string): string => {
    files.set(at, sha);
    return mdLinkUrl(relativePath(from, at));
  };
  const write: WritePorts = {
    path: (file) =>
      file.sha === ""
        ? ""
        : named(
            file.sha,
            bytesFolderPath(
              file.sha,
              fileName(file.name ?? BLOCK_FILE_NAMES[file.node], ports.typeOf(file.sha)),
            ),
          ),
    target: ports.title,
  };
  const held: TElement[] = [];
  const { coverSha, originalSha } = fields;
  if (coverSha !== null && (coverSha !== originalSha || fields.kind !== "image")) {
    const cover = `${COVERS_DIR}/${fileName(coverSha, ports.typeOf(coverSha))}`;
    held.push(heldImage(named(coverSha, cover)));
  }
  if (originalSha !== null) {
    const name = fileName(fields.originalName ?? itemName(fields), ports.typeOf(originalSha));
    held.push(heldImage(named(originalSha, bytesFolderPath(originalSha, name))));
  }
  const of = (section: LibrarySection): TElement[] =>
    writeBlocks(
      item.blocks.filter((body) => body.section === section).map((body) => body.block),
      write,
    );
  const note = [...held, ...of("note")];
  const article = of("article");
  const value: TElement[] =
    article.length > 0 ? [...note, { children: article, type: ARTICLE_SECTION_KEY }] : note;
  return {
    files: [...files].map(([at, sha]) => ({ path: at, sha })),
    markdown: value.length === 0 ? "" : `${serializeNote(headlessEditor(), value).trimEnd()}\n`,
  };
};

// One export's writer, an item at a time. Each item's path is one no item before it took, case
// aside, as a disk that folds case sees it: a title another item's file goes by takes ` 2`, and
// so on, and its frontmatter says the title.
export const exportWriter = (ports: ExportPorts): ((item: ExportItem) => ExportedFile) => {
  const taken = new Set<string>();
  const freePath = (folder: string, name: string): string => {
    let path = joinPath(folder, `${name}.md`);
    for (let clash = 2; taken.has(path.toLowerCase()); clash += 1) {
      path = joinPath(folder, `${name} ${String(clash)}.md`);
    }
    taken.add(path.toLowerCase());
    return path;
  };
  return (item) => {
    const { fields } = item;
    const path = freePath(item.folder.map(folderName).join("/"), itemName(fields));
    const front = writeFrontmatter(
      item.id,
      fields,
      docStem(path) === fields.title ? null : fields.title,
    );
    const body = writeBody(item, path, ports);
    return {
      files: body.files,
      leftOut: front.leftOut,
      path,
      text: `---\n${front.yaml}\n---\n${body.markdown === "" ? "" : `\n${body.markdown}`}`,
    };
  };
};
