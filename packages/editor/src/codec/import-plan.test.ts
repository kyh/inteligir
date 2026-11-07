import { describe, expect, it } from "vitest";

import { blockHash } from "@repo/notes/library/block-hash";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import { deriveItem } from "@repo/notes/library/derive-item";
import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import { collectFileShas } from "@repo/notes/library/library-nodes";
import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";

import { CODEC_NOW, withoutId } from "../test-support/codec-ports";
import { mediaTypeOfName } from "@repo/notes/items/item-kind";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/folder-path";
import { wikiFilingKeys, wikiTargetKeys } from "@repo/notes/knowledge/link-resolve";

import {
  beginExport,
  exportDoc,
  exportFolderPaths,
  exportTarget,
  planExportDoc,
} from "./export-plan";
import type { ExportFile, ExportFolder, ExportStore, PlannedExportDoc } from "./export-plan";
import {
  importPathKind,
  importPlannedDoc,
  openPlan,
  planFileItems,
  planImport,
  unwrapExport,
} from "./import-plan";
import type { ImportEntry, PlanIds } from "./import-plan";
import type { ExportItem, ImportedFields } from "./item-markdown";

const PROJECT_ID = "0195f3a0-5c1e-7000-8000-00000000000a";
const PAGE_ID = "0195f3a0-5c1e-7000-8000-00000000000b";

// an Obsidian vault beside a note this app wrote, the binaries named by a pretend sha
const OBSIDIAN_VAULT = {
  ".obsidian/app.json": '{"theme":"moonstone"}',
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
    ":::article",
    "",
    "The page says %%i:h1:start%%a passage%%i:h1:end%% here, with #hashtag text.",
    "",
    ":::",
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
    "board.canvas",
    "Untitled.base",
    "orphan.pdf",
    "Reports/Q3 report.docx",
    "Projects/Specs/spec.pdf",
    "assets/covers/fedcba9876543210.jpg",
  ].map((path) => [path, shaOf(path)]),
);

// each pretend file's media type, by the extension it was found under
const mediaTypeOf = (sha: string): string | null =>
  mediaTypeOfName([...BINARIES].find(([, held]) => held === sha)?.[0] ?? "");

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
    newItemId: () => {
      uuid += 1;
      return `0195f3a0-5c1e-7000-9000-${String(uuid).padStart(12, "0")}`;
    },
  };
};

interface LibraryItem {
  readonly itemId: string;
  readonly folderPath: string;
  readonly fields: ImportedFields;
  readonly blocks: readonly { block: LibraryBlock; ord: string; section: "note" | "article" }[];
  readonly annotations: ExportItem["annotations"];
}

interface ReadLibrary {
  readonly items: LibraryItem[];
  readonly folders: ExportFolder[];
  readonly skipped: string[];
}

// the folder each item sits in and every folder above it, as the cell makes them, each by its path
const foldersOf = (items: readonly LibraryItem[]): ExportFolder[] => {
  const paths = new Set<string>();
  for (const item of items) {
    for (let path = item.folderPath; path !== ""; path = dirnamePath(path)) {
      paths.add(path);
    }
  }
  return [...paths].map((path) => {
    const parent = dirnamePath(path);
    return { id: path, name: basenamePath(path), parentId: parent === "" ? null : parent };
  });
};

// the three passes over a folder's files, as an import job runs them
const readFolder = (
  files: Readonly<Record<string, string>>,
  binaries: ReadonlyMap<string, string>,
): ReadLibrary => {
  const ids = counters();
  const skipped: string[] = [];
  const entries: ImportEntry[] = [];
  const texts = new Map<string, string>();
  const listed = unwrapExport([
    ...Object.entries(files).map(([path, text]) => ({ path, text })),
    ...[...binaries].map(([path, sha]) => ({ path, sha })),
  ]);
  for (const entry of listed) {
    const { path } = entry;
    const kind = importPathKind(path);
    if ("sha" in entry) {
      if (kind === "file") {
        entries.push({ kind, path, sha: entry.sha });
      } else {
        skipped.push(path);
      }
    } else if (kind === "doc" || kind === "store") {
      entries.push({ kind, path, text: entry.text });
      texts.set(path, entry.text);
    } else if (kind === "skipped") {
      skipped.push(path);
    }
  }
  const plan = planImport(entries, ids);
  const reader = openPlan(plan);
  const attached = new Set<string>();
  const originals = new Set<string>();
  const items: LibraryItem[] = [];
  for (const doc of plan.docs) {
    const read = importPlannedDoc(reader, doc, texts.get(doc.path) ?? "", {
      ...ids,
      now: CODEC_NOW,
    });
    if (!read.ok) {
      throw new Error(`${read.path}: ${read.reason}`);
    }
    const { coverSha, originalSha } = read.read.item.fields;
    for (const sha of [coverSha, originalSha]) {
      if (sha !== null) {
        attached.add(sha);
      }
    }
    for (const { block } of read.read.item.blocks) {
      collectFileShas(block, attached);
    }
    if (originalSha !== null) {
      originals.add(originalSha);
    }
    items.push({
      annotations: read.read.item.annotations,
      blocks: read.read.item.blocks,
      fields: read.read.item.fields,
      folderPath: dirnamePath(doc.path),
      itemId: doc.itemId,
    });
  }
  for (const item of planFileItems(plan, { attached, originals }, ids, CODEC_NOW)) {
    items.push({ ...item, annotations: {}, blocks: [] });
  }
  return { folders: foldersOf(items), items, skipped };
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

const textOf = (item: LibraryItem): string =>
  nodesOf(item)
    .flatMap((node) => ("text" in node ? [node.text] : []))
    .join("");

describe("an Obsidian vault read into the library", () => {
  const library = readFolder(OBSIDIAN_VAULT, BINARIES);
  const daily = byTitle(library, "Daily");
  const project = byTitle(library, "Project X");

  it("skips Obsidian's settings and reads the highlights' store as no item", () => {
    expect(library.skipped).toStrictEqual([".obsidian/app.json"]);
    expect(library.items.map((item) => item.fields.title).toSorted()).toStrictEqual([
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

  it("reads an AGENTS.md at the root as a note like any other", () => {
    const { items, skipped } = readFolder({ "AGENTS.md": "File under Inbox.\n" }, new Map());
    expect(items.map((item) => [item.fields.title, item.folderPath])).toStrictEqual([
      ["AGENTS", ""],
    ]);
    expect(skipped).toStrictEqual([]);
  });

  it("makes no item of a cover no item holds", () => {
    expect(
      library.items.some(
        (item) => item.fields.originalSha === shaOf("assets/covers/fedcba9876543210.jpg"),
      ),
    ).toBe(false);
  });

  it("files every item in its folder", () => {
    expect(daily.folderPath).toBe("Notes");
    expect(project.folderPath).toBe("Projects");
    expect(byTitle(library, "orphan").folderPath).toBe("");
    // a file alone in a folder of its own sits under the folder its parent already is
    expect(byTitle(library, "spec").folderPath).toBe("Projects/Specs");
  });

  it("resolves links by path, name, alias and id, a block ref beside them", () => {
    const links = nodesOf(daily).flatMap((node) =>
      "type" in node && node.type === "wikiLink" ? [node] : [],
    );
    expect(
      links.map(({ alias, blockRef, itemId, title }) => ({ alias, blockRef, itemId, title })),
    ).toStrictEqual([
      { alias: undefined, blockRef: "goal", itemId: PROJECT_ID, title: "Project X" },
      { alias: "the project", blockRef: undefined, itemId: PROJECT_ID, title: "Project X" },
      { alias: undefined, blockRef: undefined, itemId: PROJECT_ID, title: "Project X" },
      { alias: undefined, blockRef: undefined, itemId: null, title: "Missing" },
      { alias: undefined, blockRef: undefined, itemId: PROJECT_ID, title: "Project X" },
    ]);
  });

  it("names a block by its `^ref`, on its own line or at its end", () => {
    expect(project.blocks.map(({ block }) => [block.type, block.ref])).toStrictEqual([
      ["p", "goal"],
      ["table", "tbl"],
    ]);
    expect(JSON.stringify(project.blocks[0]?.block)).not.toContain("^goal");
  });

  it("reads a highlight and a comment out of the person's writing, and keeps a tag its text", () => {
    const nodes = nodesOf(daily);
    const marker = nodes.find((node) => "type" in node && node.type === "annotationMarker");
    expect(marker).toMatchObject({ edge: "start" });
    expect(Object.values(daily.annotations)).toStrictEqual([
      {
        createdAt: CODEC_NOW / 1000,
        quote: "important",
        source: "user",
        text: "",
        updatedAt: CODEC_NOW / 1000,
      },
    ]);
    expect(nodes.filter((node) => "type" in node && node.type === "opaque")).toStrictEqual([
      { children: [{ text: "" }], source: "%%not shown%%", type: "opaque" },
    ]);
    expect(textOf(daily)).toContain(" under #log and #log/today.");
  });

  it("plans no more aliases than an item holds", () => {
    const aliases = Array.from(
      { length: ITEM_FIELD_CAPS.listEntries + 1 },
      (_, index) => `- a${String(index)}`,
    );
    const plan = planImport(
      [{ kind: "doc", path: "Many.md", text: `---\naliases:\n${aliases.join("\n")}\n---\n` }],
      counters(),
    );
    expect(plan.docs[0]?.aliases).toHaveLength(ITEM_FIELD_CAPS.listEntries);
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

  it.each(["a%20b.png", "100%.png", "a b.png"])("embeds %s as the bytes it names", (name) => {
    const sha = shaOf(name);
    const { items } = readFolder({ "Note.md": `![[${name}]]\n` }, new Map([[name, sha]]));
    expect(items.map((item) => item.fields.title)).toStrictEqual(["Note"]);
    expect(items[0]?.blocks.map(({ block }) => block)).toMatchObject([{ sha, type: "img" }]);
  });

  it("keeps a property no field reads, and the item's own id", () => {
    expect(project.itemId).toBe(PROJECT_ID);
    expect(project.fields).toMatchObject({
      aliases: ["PX"],
      properties: { status: "active" },
      tags: ["work"],
    });
  });

  it("reads a saved link: its cover and its page", () => {
    const page = byTitle(library, "Read later");
    expect(page.fields).toMatchObject({
      coverSha: shaOf("assets/covers/0123456789abcdef.jpg"),
      fetchState: "filled",
    });
    expect(page.blocks.map(({ section }) => section)).toStrictEqual(["article"]);
    // the page's hashtags are the page's text, and its highlight kept from the store
    expect(textOf(page)).toContain("with #hashtag text.");
    expect(Object.keys(page.annotations)).toStrictEqual(["h1"]);
  });
});

// the plan's steps as a writer with room for the whole library takes them, over a store in memory:
// every item given its file first, each written with its links spelled from the files that share
// their keys, the files the items hold last
const exportInSteps = (
  library: ReadLibrary,
  items: readonly ExportItem[],
  rules: string | null,
): ExportFile[] => {
  const taken = new Map<string, string>();
  const searched = new Map<string, number>();
  const placed = new Map<string, { readonly path: string; readonly sha: string }>();
  const store: ExportStore = {
    place: (key, file) => {
      placed.set(key, file);
    },
    placed: (key) => placed.get(key)?.path ?? null,
    search: (key, n) => {
      searched.set(key, n);
    },
    searched: (key) => searched.get(key) ?? null,
    take: (key, path) => {
      taken.set(key, path);
    },
    taken: (key) => taken.has(key),
  };
  beginExport(store, rules);
  const folders = exportFolderPaths(library.folders);
  const planned = new Map<string, PlannedExportDoc & { readonly aliases: readonly string[] }>();
  for (const item of items) {
    const { aliases, folderId, title } = item.fields;
    const dir = folderId === null ? "" : (folders.get(folderId) ?? "");
    planned.set(item.id, { ...planExportDoc(title, dir, store), aliases });
  }
  const target = (itemId: string): string | null => {
    const doc = planned.get(itemId);
    if (doc === undefined) {
      return null;
    }
    const keys = new Set(wikiTargetKeys(doc.path));
    return exportTarget(
      doc.path,
      [...planned.values()].filter((other) =>
        wikiFilingKeys(other.path, other.aliases).some((key) => keys.has(key)),
      ),
    );
  };
  const texts = items.flatMap((item) => {
    const doc = planned.get(item.id);
    return doc === undefined ? [] : exportDoc(item, doc, { mediaType: mediaTypeOf, store, target });
  });
  return [
    ...texts,
    ...[...placed.values()].map((file): ExportFile => ({ kind: "bytes", ...file })),
  ];
};

const storedOf = (item: LibraryItem): [string, StoredBlock][] =>
  item.blocks.map((placed) => [placed.block.id, { ...placed, hash: blockHash(placed.block) }]);

const asFields = (item: LibraryItem): ExportItem["fields"] => ({
  ...item.fields,
  deletedAt: null,
  folderId: item.folderPath === "" ? null : item.folderPath,
});

const exportOf = (library: ReadLibrary, rules: string | null = null): ExportFile[] => {
  const items = library.items.map((item): ExportItem => ({
    annotations: item.annotations,
    blocks: new Map(storedOf(item)),
    fields: asFields(item),
    id: item.itemId,
  }));
  return exportInSteps(library, items, rules);
};

// where an export writes bytes no name came with: under their sha
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
  it("holds for the Obsidian vault, ids aside", () => {
    const first = readFolder(OBSIDIAN_VAULT, BINARIES);
    const files = exportOf(first);
    const texts = Object.fromEntries(
      files.flatMap((file) => (file.kind === "text" ? [[file.path, file.text]] : [])),
    );
    const bytes = new Map(
      files.flatMap((file): [string, string][] =>
        file.kind === "bytes" ? [[file.path, file.sha]] : [],
      ),
    );
    // every file under the name it was saved under, so a canvas still opens as one; a cover and
    // an image a note embeds by its bytes alone, under their bytes' own names
    expect([...bytes.keys()].toSorted()).toStrictEqual(
      [
        "assets/Q3 report.docx",
        "assets/Untitled.base",
        "assets/board.canvas",
        "assets/orphan.pdf",
        "assets/spec.pdf",
        byBytes("assets/covers", "assets/covers/0123456789abcdef.jpg", "jpg"),
        byBytes("assets", "assets/shot.png", "png"),
      ].toSorted(),
    );
    const second = readFolder(texts, bytes);
    expect(contentOf(second)).toStrictEqual(contentOf(first));
  });

  it.each(["Invoice #12.pdf", "a%20b.pdf", "100%.pdf"])(
    "keeps %s one item with its bytes",
    (name) => {
      const sha = shaOf(name);
      const files = exportOf(readFolder({}, new Map([[name, sha]])));
      const texts = Object.fromEntries(
        files.flatMap((file) => (file.kind === "text" ? [[file.path, file.text]] : [])),
      );
      const bytes = new Map(
        files.flatMap((file) => (file.kind === "bytes" ? [[file.path, file.sha] as const] : [])),
      );
      const { items } = readFolder(texts, bytes);
      expect(items.map((item) => item.fields)).toMatchObject([
        { kind: "pdf", originalName: name, originalSha: sha },
      ]);
    },
  );

  it("keeps a file a person saved under a name an operating system leaves behind", () => {
    const sha = shaOf("Thumbs.db");
    const saved = readFolder({}, new Map([["kept.bin", sha]]));
    const files = exportOf({
      ...saved,
      items: saved.items.map((item) => ({
        ...item,
        fields: { ...item.fields, originalName: "Thumbs.db" },
      })),
    });
    const texts = Object.fromEntries(
      files.flatMap((file) => (file.kind === "text" ? [[file.path, file.text]] : [])),
    );
    const bytes = new Map(
      files.flatMap((file) => (file.kind === "bytes" ? [[file.path, file.sha] as const] : [])),
    );
    expect([...bytes.keys()]).toStrictEqual(["assets/kept.bin"]);
    expect(readFolder(texts, bytes).items.map((item) => item.fields)).toMatchObject([
      { kind: "file", originalSha: sha },
    ]);
  });

  it.each(["__MACOSX", "Thumbs.db", "desktop.ini", "DESKTOP.INI"])(
    "keeps the items of a person's folder named %s",
    (name) => {
      const first = readFolder({ "Filed/Kept.md": "A note.\n" }, new Map());
      const texts = Object.fromEntries(
        exportOf({
          ...first,
          folders: first.folders.map((folder) => ({ ...folder, name })),
        }).flatMap((file) => (file.kind === "text" ? [[file.path, file.text]] : [])),
      );
      const back = readFolder(texts, new Map());
      expect(back.skipped).toStrictEqual([]);
      expect(back.items.map((item) => item.fields.title)).toStrictEqual(["Kept"]);
      expect(back.folders.map((folder) => folder.name)).toStrictEqual([`${name} (folder)`]);
    },
  );

  it.each([".env", ".gitignore", "notes.md", "Thumbs.db.bak"])(
    "reads %s as a file in a bytes folder",
    (name) => {
      expect(importPathKind(`assets/0123456789abcdef/${name}`)).toBe("file");
    },
  );

  describe("under the folder it was unpacked to", () => {
    const TOP = "Library 2026-11-07";
    const first = readFolder(OBSIDIAN_VAULT, BINARIES);
    const files = exportOf(first, "File under Inbox.\n");
    const texts = Object.fromEntries(
      files.flatMap((file) => (file.kind === "text" ? [[file.path, file.text]] : [])),
    );
    const bytes = new Map(
      files.flatMap((file): [string, string][] =>
        file.kind === "bytes" ? [[file.path, file.sha]] : [],
      ),
    );
    const under = <Value>(entries: Iterable<readonly [string, Value]>): [string, Value][] =>
      [...entries].map(([path, value]) => [`${TOP}/${path}`, value]);
    const litter = {
      ".DS_Store": "left by Finder",
      [`${TOP}/.DS_Store`]: "left by Finder",
      [`__MACOSX/${TOP}/._Daily.md`]: "left by the Mac's zip",
    };

    it("holds, what a Mac's Compress adds passed over", () => {
      const wrapped = readFolder(
        { ...Object.fromEntries(under(Object.entries(texts))), ...litter },
        new Map(under(bytes)),
      );
      expect(contentOf(wrapped)).toStrictEqual(contentOf(readFolder(texts, bytes)));
      expect(wrapped.skipped.toSorted()).toStrictEqual(
        [".DS_Store", ".DS_Store", `__MACOSX/${TOP}/._Daily.md`].toSorted(),
      );
    });

    it.each([
      [".inteligir/annotations/0195f3a0-5c1e-7000-8000-00000000000b.json", "the highlights' store"],
      ["assets/shot.png", "a kept file"],
    ])("takes %s for the mark of an export: %s", (mark) => {
      expect(
        unwrapExport([{ path: `${TOP}/${mark}` }, { path: `${TOP}/Filed/Spec.md` }]),
      ).toStrictEqual([{ path: mark }, { path: "Filed/Spec.md" }]);
    });

    it.each([
      ["a folder with no mark of an export", ["MyVault/.obsidian/app.json", "MyVault/Daily.md"]],
      ["a file beside the folder", [`${TOP}/assets/shot.png`, "Stray.md"]],
      ["a second folder beside it", [`${TOP}/assets/shot.png`, "Other/Note.md"]],
      ["an export at the root", ["assets/shot.png", "Daily.md"]],
      ["an export whose only folder is its assets", ["assets/shot.png"]],
      ["nothing but what a Mac left", ["__MACOSX/assets/._shot.png"]],
      ["a mark that is a file", [`${TOP}/assets`, `${TOP}/Daily.md`]],
    ])("keeps %s", (_shape, paths) => {
      const entries = paths.map((path) => ({ path }));
      expect(unwrapExport(entries)).toStrictEqual(entries);
    });

    it("keeps an Obsidian vault's folder as a folder", () => {
      const { folders, items } = readFolder({ "MyVault/Notes/Daily.md": "A note.\n" }, new Map());
      expect(items.map((item) => item.folderPath)).toStrictEqual(["MyVault/Notes"]);
      expect(folders.map((folder) => folder.name).toSorted()).toStrictEqual(["MyVault", "Notes"]);
    });
  });

  it("keeps two items with no title of their own, and a link to one", () => {
    const first = readFolder(
      {
        "Links.md": "See [[a]].\n",
        "a.md": "Groceries\n",
        "b.md": "Call the dentist\n",
      },
      new Map(),
    );
    const files = exportOf({
      ...first,
      items: first.items.map((item) =>
        item.fields.title === "Links" ? item : { ...item, fields: { ...item.fields, title: "" } },
      ),
    });
    const texts = Object.fromEntries(
      files.flatMap((file) => (file.kind === "text" ? [[file.path, file.text]] : [])),
    );
    expect(Object.keys(texts).toSorted()).toStrictEqual([
      "Links.md",
      "Untitled 2.md",
      "Untitled.md",
    ]);

    const back = readFolder(texts, new Map());
    expect(back.items.map((item) => item.fields.title).toSorted()).toStrictEqual(["", "", "Links"]);
    expect(back.items.map((item) => item.fields.properties)).toStrictEqual([{}, {}, {}]);
    expect(
      back.items
        .map((item) => deriveItem(asFields(item), new Map(storedOf(item))).card.title)
        .toSorted(),
    ).toStrictEqual(["Call the dentist", "Groceries", "Links"]);
    const link = nodesOf(byTitle(back, "Links")).find(
      (node) => "type" in node && node.type === "wikiLink",
    );
    const reached = back.items.find((item) => textOf(item) === "Groceries");
    expect(link).toMatchObject({ itemId: reached?.itemId, title: "" });
  });

  it("keeps the title of an item whose file took another spelling", () => {
    const first = readFolder(
      {
        "a.md": "---\ntitle: Home\n---\nThe first.\n",
        "b.md": "---\ntitle: Home\n---\nThe second.\n",
        "c.md": "---\ntitle: AGENTS\n---\nNot the filing rules.\n",
      },
      new Map(),
    );
    const texts = Object.fromEntries(
      exportOf(first, "File under Inbox.\n").flatMap((file) =>
        file.kind === "text" ? [[file.path, file.text]] : [],
      ),
    );
    expect(Object.keys(texts).toSorted()).toStrictEqual(["AGENTS 2.md", "Home 2.md", "Home.md"]);
    const titles = readFolder(texts, new Map()).items.map((item) => item.fields.title);
    expect(titles.toSorted()).toStrictEqual(["AGENTS", "Home", "Home"]);
  });
});
