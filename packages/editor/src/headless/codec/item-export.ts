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
import { headlessEditor, serializeNote } from "@repo/editor/headless/codec/markdown-doc";
import { ARTICLE_SECTION_KEY } from "@repo/editor/headless/markdown/md-rules";

import { writeFrontmatter } from "./item-fields";
import { mdLinkUrl } from "./link-extract";
import { leaf } from "./slate-leaves";
import { writeBlocks } from "./write-blocks";
import type { WritePorts, WrittenFile } from "./write-blocks";

export interface ExportItem {
  readonly id: string;
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
  readonly folder: readonly string[];
}

export interface ExportPorts {
  readonly title: (itemId: string) => string | null;
  readonly typeOf: (sha: string) => string;
}

interface ExportedBytes {
  readonly sha: string;
  readonly path: string;
}

export interface ExportedFile {
  readonly path: string;
  readonly text: string;
  readonly files: readonly ExportedBytes[];
  readonly leftOut: number;
}

export const heldShas = ({
  blocks,
  fields,
}: {
  readonly blocks: readonly BodyBlock[];
  readonly fields: Pick<LibraryItemFields, "coverSha" | "originalSha">;
}) => {
  const shas = new Set<string>();

  for (const sha of [fields.coverSha, fields.originalSha]) {
    if (sha !== null) {
      shas.add(sha);
    }
  }

  for (const { block } of blocks) {
    collectFileShas(block, shas);
  }

  return [...shas] satisfies string[];
};

const BLOCK_FILE_NAMES = {
  file: "File",
  img: "Image",
  video: "Video",
} as const satisfies Record<WrittenFile["node"], string>;

const PLAIN_EXTENSION = /^\.[A-Za-z0-9]{1,10}$/u;

const bareType = (type: string) => (type.split(";")[0] ?? "").trim().toLowerCase() satisfies string;

const fileName = (name: string, type: string) => {
  const written = extnamePath(name);
  const extension = PLAIN_EXTENSION.test(written) ? written : "";
  const stem = itemNameFromTitle(name.slice(0, name.length - extension.length)) ?? "File";
  const kept = bareType(type);
  const [typed] = extensionsOfType(kept);
  const named = `${stem}${extension}`;

  return (
    typed === undefined || mediaTypeOfName(named) === kept ? named : `${named}.${typed}`
  ) satisfies string;
};

const folderName = (name: string) => {
  const written = itemNameFromTitle(name) ?? "Folder";

  return (isOsLitterPath(written) ? `${written} (folder)` : written) satisfies string;
};

const itemName = (fields: LibraryItemFields) =>
  (itemNameFromTitle(fields.title) ??
    (fields.url === null ? UNTITLED : itemNameFromUrl(fields.url))) satisfies string;

const heldImage = (url: string) =>
  ({
    caption: [leaf("", {})],
    children: [leaf("", {})],
    type: "img",
    url,
  }) satisfies TElement;

interface WrittenBody {
  readonly markdown: string;
  readonly files: readonly ExportedBytes[];
}

const writeBody = (item: ExportItem, path: string, ports: ExportPorts) => {
  const { fields } = item;
  const files = new Map<string, string>();
  const from = dirnamePath(path);

  const named = (sha: string, at: string) => {
    files.set(at, sha);

    return mdLinkUrl(relativePath(from, at)) satisfies string;
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

  const of = (section: LibrarySection) =>
    writeBlocks(
      item.blocks.filter((body) => body.section === section).map((body) => body.block),
      write,
    ) satisfies TElement[];

  const note = [...held, ...of("note")];
  const article = of("article");

  const value: TElement[] =
    article.length > 0 ? [...note, { children: article, type: ARTICLE_SECTION_KEY }] : note;

  return {
    files: [...files].map(([at, sha]) => ({ path: at, sha })),
    markdown: value.length === 0 ? "" : `${serializeNote(headlessEditor(), value).trimEnd()}\n`,
  } satisfies WrittenBody;
};

export const exportWriter = (ports: ExportPorts) => {
  const taken = new Set<string>();

  const freePath = (folder: string, name: string) => {
    let path = joinPath(folder, `${name}.md`);

    for (let clash = 2; taken.has(path.toLowerCase()); clash += 1) {
      path = joinPath(folder, `${name} ${String(clash)}.md`);
    }

    taken.add(path.toLowerCase());

    return path satisfies string;
  };

  return ((item) => {
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
  }) satisfies (item: ExportItem) => ExportedFile;
};
