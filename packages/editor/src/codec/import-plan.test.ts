import { describe, expect, it } from "vitest";

import { blockHash } from "@repo/notes/library/block-hash";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";

import { CODEC_NOW, withoutId } from "../test-support/codec-ports";
import { planExport } from "./export-plan";
import type { ExportFile } from "./export-plan";
import {
  importPathKind,
  importPlannedDoc,
  openPlan,
  planFileItems,
  planImport,
} from "./import-plan";
import type { ImportEntry, PlanIds, PlannedFolder } from "./import-plan";
import type { ExportItem, ImportedFields } from "./item-markdown";

const PROJECT_ID = "0195f3a0-5c1e-7000-8000-00000000000a";
const PAGE_ID = "0195f3a0-5c1e-7000-8000-00000000000b";

// an Obsidian vault beside a note this app wrote, the binaries named by a pretend sha
const VAULT = {
  ".obsidian/app.json": '{"theme":"moonstone"}',
  "AGENTS.md": "File what I read under Inbox.\n",
  ".inteligir/annotations/0195f3a0-5c1e-7000-8000-00000000000b.json": `${JSON.stringify(
    {
      h1: {
        createdAt: 1_777_000_000,
        quote: "a passage",
        source: "user",
        text: "",
        updatedAt: 1_777_000_000,
      },
    },
    null,
    2,
  )}\n`,
  "Notes/Daily.md": [
    "# Daily",
    "",
    "See [[Project X#^goal]], [[Project X|the project]], [[PX]] and [[Missing]].",
    "",
    "An ==important== line %%not shown%% under #log and #log/today.",
    "",
    "![[shot.png|300]]",
    "",
    "![[board.canvas]]",
    "",
    `By id: [[Renamed|${PROJECT_ID}]]`,
    "",
  ].join("\n"),
  "Projects/Project X.md": [
    "---",
    `id: ${PROJECT_ID}`,
    "aliases: [PX]",
    "tags: [work]",
    "status: active",
    "---",
    "",
    "The goal is shipping. ^goal",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "^tbl",
    "",
  ].join("\n"),
  "Inbox/Read later.md": [
    "---",
    `id: ${PAGE_ID}`,
    "kind: link",
    "url: https://example.com/read",
    "saved: 2026-05-01T10:00:00Z",
    "fetched: 2026-05-01T10:00:05Z",
    "---",
    "",
    "![](assets/covers/0123456789abcdef.jpg)",
    "",
    "The page says %%i:h1:start%%a passage%%i:h1:end%% here, with #hashtag text.",
    "",
    "[Copy of the page](assets/pages/0123456789abcdef.html)",
    "",
  ].join("\n"),
} satisfies Record<string, string>;

const shaOf = (path: string): string =>
  [...path]
    .map((char) => (char.codePointAt(0) ?? 0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);

const BINARIES = new Map(
  [
    "assets/shot.png",
    "assets/covers/0123456789abcdef.jpg",
    "assets/pages/0123456789abcdef.html",
    "board.canvas",
    "Untitled.base",
    "orphan.pdf",
    "Reports/Q3 report.docx",
    "Projects/Specs/spec.pdf",
    "assets/covers/fedcba9876543210.jpg",
  ].map((path) => [path, shaOf(path)]),
);

// each pretend file's media type, by the extension it was found under
const MEDIA_TYPES = new Map([
  [".html", "text/html"],
  [".jpg", "image/jpeg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
]);
const mediaTypeOf = (sha: string): string | null => {
  const path = [...BINARIES].find(([, held]) => held === sha)?.[0] ?? "";
  return MEDIA_TYPES.get(path.slice(path.lastIndexOf("."))) ?? null;
};

const counters = (): PlanIds & { newBlockId: () => string; newAnnotationId: () => string } => {
  let next = 0;
  const mint = (prefix: string) => () => {
    next += 1;
    return `${prefix}${String(next)}`;
  };
  let uuid = 0;
  return {
    newAnnotationId: mint("hl"),
    newBlockId: mint("b"),
    newFolderId: mint("folder-"),
    newItemId: () => {
      uuid += 1;
      return `0195f3a0-5c1e-7000-9000-${String(uuid).padStart(12, "0")}`;
    },
  };
};

interface LibraryItem {
  readonly itemId: string;
  readonly folderPath: string | null;
  readonly fields: ImportedFields;
  readonly blocks: readonly { block: LibraryBlock; ord: string; section: "note" | "article" }[];
  readonly annotations: ExportItem["annotations"];
}

interface ReadLibrary {
  readonly items: LibraryItem[];
  readonly folders: PlannedFolder[];
  readonly folderPaths: Map<string, string>;
  readonly skipped: string[];
  readonly rules: string | null;
}

// the three passes over a folder's files, as an import job runs them
const readFolder = (
  files: Readonly<Record<string, string>>,
  binaries: ReadonlyMap<string, string>,
): ReadLibrary => {
  const ids = counters();
  const skipped: string[] = [];
  const entries: ImportEntry[] = [];
  for (const [path, text] of Object.entries(files)) {
    const kind = importPathKind(path);
    if (kind === "doc" || kind === "rules" || kind === "store") {
      entries.push({ kind, path, text });
    } else if (kind === "skipped") {
      skipped.push(path);
    }
  }
  for (const [path, sha] of binaries) {
    entries.push({ kind: "file", path, sha });
  }
  const plan = planImport(entries, ids);
  const reader = openPlan(plan);
  const attached = new Set<string>();
  const originals = new Set<string>();
  const items: LibraryItem[] = [];
  const folderPaths = new Map(plan.folders.map((folder) => [folder.id, folder.path]));
  for (const doc of plan.docs) {
    const read = importPlannedDoc(reader, doc, files[doc.path] ?? "", { ...ids, now: CODEC_NOW });
    if (!read.ok) {
      throw new Error(`${read.path}: ${read.reason}`);
    }
    for (const sha of read.read.files) {
      attached.add(sha);
    }
    if (read.read.item.fields.originalSha !== null) {
      originals.add(read.read.item.fields.originalSha);
    }
    items.push({
      annotations: read.read.item.annotations,
      blocks: read.read.item.blocks,
      fields: read.read.item.fields,
      folderPath: doc.folderId === null ? null : (folderPaths.get(doc.folderId) ?? null),
      itemId: doc.itemId,
    });
  }
  const fileItems = planFileItems(plan, { attached, originals }, ids, CODEC_NOW);
  const folders = [...plan.folders, ...fileItems.folders];
  for (const folder of fileItems.folders) {
    folderPaths.set(folder.id, folder.path);
  }
  for (const item of fileItems.items) {
    items.push({
      annotations: {},
      blocks: [],
      fields: item.fields,
      folderPath: item.folderId === null ? null : (folderPaths.get(item.folderId) ?? null),
      itemId: item.itemId,
    });
  }
  return { folderPaths, folders, items, rules: plan.rules, skipped };
};

const byTitle = (library: ReadLibrary, title: string): LibraryItem => {
  const item = library.items.find((candidate) => candidate.fields.title === title);
  if (item === undefined) {
    throw new Error(`no item titled ${title}`);
  }
  return item;
};

const nodesOf = (item: LibraryItem): LibraryNode[] => {
  const all: LibraryNode[] = [];
  const walk = (node: LibraryNode): void => {
    all.push(node);
    if (!("text" in node)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  for (const { block } of item.blocks) {
    walk(block);
  }
  return all;
};

describe("an Obsidian vault read into the library", () => {
  const library = readFolder(VAULT, BINARIES);
  const daily = byTitle(library, "Daily");
  const project = byTitle(library, "Project X");

  it("skips Obsidian's settings and reads the highlights' store as no item", () => {
    expect(library.skipped).toEqual([".obsidian/app.json"]);
    expect(library.items.map((item) => item.fields.title).toSorted()).toEqual([
      "Daily",
      "Project X",
      "Q3 report",
      "Read later",
      "Untitled",
      "board",
      "orphan",
      "spec",
    ]);
  });

  it("keeps the filing rules apart from every item, and a cover no item holds is no item", () => {
    expect(library.rules).toBe("File what I read under Inbox.\n");
    expect(
      library.items.some(
        (item) => item.fields.originalSha === shaOf("assets/covers/fedcba9876543210.jpg"),
      ),
    ).toBe(false);
  });

  it("files every item in its folder", () => {
    expect(daily.folderPath).toBe("Notes");
    expect(project.folderPath).toBe("Projects");
    expect(byTitle(library, "orphan").folderPath).toBeNull();
    // a file alone in a folder of its own sits under the folder its parent already is
    expect(byTitle(library, "spec").folderPath).toBe("Projects/Specs");
    const projects = library.folders.find((folder) => folder.path === "Projects");
    expect(library.folders.filter((folder) => folder.path === "Projects")).toHaveLength(1);
    expect(library.folders.find((folder) => folder.path === "Projects/Specs")).toMatchObject({
      name: "Specs",
      parentId: projects?.id,
    });
  });

  it("resolves links by path, name, alias and id, a block ref beside them", () => {
    const links = nodesOf(daily).flatMap((node) =>
      "type" in node && node.type === "wikiLink" ? [node] : [],
    );
    expect(
      links.map(({ alias, blockRef, itemId, title }) => ({ alias, blockRef, itemId, title })),
    ).toEqual([
      { alias: undefined, blockRef: "goal", itemId: PROJECT_ID, title: "Project X" },
      { alias: "the project", blockRef: undefined, itemId: PROJECT_ID, title: "Project X" },
      { alias: undefined, blockRef: undefined, itemId: PROJECT_ID, title: "Project X" },
      { alias: undefined, blockRef: undefined, itemId: null, title: "Missing" },
      { alias: undefined, blockRef: undefined, itemId: PROJECT_ID, title: "Project X" },
    ]);
  });

  it("names a block by its `^ref`, on its own line or at its end", () => {
    expect(project.blocks.map(({ block }) => [block.type, block.ref])).toEqual([
      ["p", "goal"],
      ["table", "tbl"],
    ]);
    expect(JSON.stringify(project.blocks[0]?.block)).not.toContain("^goal");
  });

  it("reads a highlight, a comment and inline tags out of the person's writing", () => {
    const nodes = nodesOf(daily);
    const marker = nodes.find((node) => "type" in node && node.type === "annotationMarker");
    expect(marker).toMatchObject({ edge: "start" });
    expect(Object.values(daily.annotations)).toEqual([
      {
        createdAt: CODEC_NOW / 1000,
        quote: "important",
        source: "user",
        text: "",
        updatedAt: CODEC_NOW / 1000,
      },
    ]);
    expect(nodes.filter((node) => "type" in node && node.type === "opaque")).toEqual([
      { children: [{ text: "" }], source: "%%not shown%%", type: "opaque" },
    ]);
    expect(
      nodes.flatMap((node) => ("type" in node && node.type === "tag" ? [node.value] : [])),
    ).toEqual(["log", "log/today"]);
  });

  it("embeds an image with its width and a canvas as a file, and keeps the canvas an item", () => {
    const media = daily.blocks.flatMap(({ block }) =>
      block.type === "img" || block.type === "file" ? [block] : [],
    );
    expect(media).toMatchObject([
      { sha: shaOf("assets/shot.png"), type: "img", width: 300 },
      { name: "board.canvas", sha: shaOf("board.canvas"), type: "file" },
    ]);
    expect(byTitle(library, "board").fields).toMatchObject({
      kind: "file",
      originalName: "board.canvas",
      originalSha: shaOf("board.canvas"),
    });
    expect(byTitle(library, "orphan").fields).toMatchObject({
      kind: "pdf",
      originalSha: shaOf("orphan.pdf"),
    });
  });

  it("keeps a property no field reads, and the item's own id", () => {
    expect(project.itemId).toBe(PROJECT_ID);
    expect(project.fields).toMatchObject({
      aliases: ["PX"],
      properties: { status: "active" },
      tags: ["work"],
    });
  });

  it("reads a saved link from before the article section: its cover, its copy, its page", () => {
    const page = byTitle(library, "Read later");
    expect(page.fields).toMatchObject({
      copySha: shaOf("assets/pages/0123456789abcdef.html"),
      coverSha: shaOf("assets/covers/0123456789abcdef.jpg"),
      fetchState: "filled",
    });
    expect(page.blocks.map(({ section }) => section)).toEqual(["article"]);
    // the page's hashtags are the page's, and its highlight kept from the store
    expect(nodesOf(page).some((node) => "type" in node && node.type === "tag")).toBe(false);
    expect(Object.keys(page.annotations)).toEqual(["h1"]);
  });
});

const exportOf = (library: ReadLibrary): ExportFile[] => {
  const folderIds = new Map(library.folders.map((folder) => [folder.path, folder.id]));
  const items = library.items.map((item): ExportItem => ({
    annotations: item.annotations,
    blocks: new Map(
      item.blocks.map((placed): [string, StoredBlock] => [
        placed.block.id,
        { ...placed, hash: blockHash(placed.block) },
      ]),
    ),
    fields: {
      ...item.fields,
      deletedAt: null,
      folderId: item.folderPath === null ? null : (folderIds.get(item.folderPath) ?? null),
    },
    id: item.itemId,
  }));
  const byId = new Map(items.map((item) => [item.id, item]));
  return [
    ...planExport({
      folders: library.folders,
      items: items.map(({ fields, id }) => ({ fields, id })),
      mediaType: mediaTypeOf,
      read: (head) => byId.get(head.id) ?? null,
      rules: library.rules,
    }),
  ];
};

// where an export writes bytes no name came with: under their sha, as the vault's writers did
const byBytes = (dir: string, found: string, extension: string): string =>
  `${dir}/${shaOf(found).slice(0, 16)}.${extension}`;

// a library as content alone: ids aside, items by title
const contentOf = (library: ReadLibrary) =>
  library.items
    .map((item) => ({
      annotations: item.annotations,
      blocks: item.blocks.map((placed) => ({ ...placed, block: withoutId(placed.block) })),
      fields: item.fields,
      folderPath: item.folderPath,
    }))
    .toSorted((a, b) => a.fields.title.localeCompare(b.fields.title));

describe("export, then import, gives the library back", () => {
  it("holds for the vault, ids aside", () => {
    const first = readFolder(VAULT, BINARIES);
    const files = exportOf(first);
    const texts = Object.fromEntries(
      files.flatMap((file) => (file.kind === "text" ? [[file.path, file.text]] : [])),
    );
    const bytes = new Map(
      files.flatMap((file): [string, string][] =>
        file.kind === "bytes" ? [[file.path, file.sha]] : [],
      ),
    );
    // every file under the name it was saved under, so a canvas still opens as one; a cover, a
    // page copy and an image a note embeds by its bytes alone, under their bytes' own names
    expect([...bytes.keys()].toSorted()).toEqual(
      [
        "assets/Q3 report.docx",
        "assets/Untitled.base",
        "assets/board.canvas",
        "assets/orphan.pdf",
        "assets/spec.pdf",
        byBytes("assets/covers", "assets/covers/0123456789abcdef.jpg", "jpg"),
        byBytes("assets/pages", "assets/pages/0123456789abcdef.html", "html"),
        byBytes("assets", "assets/shot.png", "png"),
      ].toSorted(),
    );
    const second = readFolder(texts, bytes);
    expect(contentOf(second)).toEqual(contentOf(first));
    expect(second.rules).toBe(first.rules);
  });
});
