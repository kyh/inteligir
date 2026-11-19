import { describe, expect, it } from "vitest";

import { fileKindOfMime, UNKNOWN_FILE_TYPE } from "@repo/contract/items/item-kind";
import { dirnamePath } from "@repo/contract/knowledge/folder-path";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { blankItemFields, importedFields } from "@repo/contract/library/item-makes";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import { CODEC_NOW, withoutId } from "../../test-support/codec-ports.test-utils";
import {
  importPathKind,
  importPlannedDoc,
  openPlan,
  planFileItems,
  planImport,
} from "./import-plan";
import type { ImportEntry, PlanIds } from "./import-plan";
import { exportWriter, heldShas } from "./item-export";
import type { ExportedFile, ExportItem, ExportPorts } from "./item-export";
import type { ImportedItem } from "./item-markdown";
import { readBody } from "./read-body";

const DAY = 86_400_000;

const shaOf = (hex: string) => hex.repeat(64) satisfies string;

const HELD = {
  "clip.mp4": { sha: shaOf("f"), type: "video/mp4" },
  "deck.pdf": { sha: shaOf("d"), type: "application/pdf" },
  "photo.jpg": { sha: shaOf("a"), type: "image/jpeg" },
  "Q3 report.pdf": { sha: shaOf("b"), type: "application/pdf" },
  "cover.webp": { sha: shaOf("c"), type: "image/webp" },
  "whiteboard.png": { sha: shaOf("e"), type: "image/png" },
} as const;

const heldFile = (name: string) => Object.entries(HELD).find(([held]) => held === name)?.[1];

const NOTE_ID = "0195f3a0-5c1e-7000-8000-000000000001";
const LINK_ID = "0195f3a0-5c1e-7000-8000-000000000002";
const DECK_ID = "0195f3a0-5c1e-7000-8000-000000000003";
const BOARD_ID = "0195f3a0-5c1e-7000-8000-000000000004";
const GONE_ID = "0195f3a0-5c1e-7000-8000-000000000005";
const TWIN_ID = "0195f3a0-5c1e-7000-8000-000000000006";
const ODD_ID = "0195f3a0-5c1e-7000-8000-000000000007";
const TALK_ID = "0195f3a0-5c1e-7000-8000-000000000008";
const UNHELD_ID = "0195f3a0-5c1e-7000-8000-0000000000ff";

const TITLES = new Map([
  [NOTE_ID, "Launch plan"],
  [LINK_ID, "How to take smart notes"],
  [UNHELD_ID, "The old plan"],
]);

let blockIds = 0;

const newBlockId = () => {
  blockIds += 1;

  return `block-${String(blockIds)}` satisfies string;
};

const blocks = (section: LibrarySection, markdown: string) => {
  const read = readBody(markdown, {
    links: {
      image: (url) => {
        const file = heldFile(url);

        return file === undefined
          ? null
          : { kind: fileKindOfMime(file.type), name: url, path: url, sha: file.sha };
      },
      item: (key) => {
        const title = TITLES.get(key);

        return title === undefined ? null : { itemId: key, title };
      },
    },
    newBlockId,
  });

  if (!read.ok) {
    throw new Error(`the fixture's markdown refused: ${read.reason.kind}`);
  }

  return read.blocks.map((block) => ({ block, section })) satisfies BodyBlock[];
};

const fieldsOf = (fields: Partial<LibraryItemFields>) =>
  ({
    ...blankItemFields(CODEC_NOW - 30 * DAY),
    ...fields,
  }) satisfies LibraryItemFields;

const noteBody = (unheld: string) =>
  [
    "# Launch",
    "",
    `Read [How to take smart notes](mention:${LINK_ID}) first, then ${unheld}.`,
    "",
    "![The team](photo.jpg)",
    "",
    "![](<Q3 report.pdf>)",
    "",
    "![](clip.mp4)",
    "",
    "- [ ] ship it",
    "- [x] **write** it",
  ].join("\n") satisfies string;

const NOTE: ExportItem = {
  blocks: blocks("note", noteBody(`[the old plan](mention:${UNHELD_ID})`)),
  fields: fieldsOf({
    aliases: ["Plan B"],
    author: "Ada Lovelace",
    description: "What ships, and when.",
    lang: "en",
    pinnedAt: CODEC_NOW - DAY,
    properties: {
      "1.0": "a key that reads as a number",
      budget: { notes: "tight", q1: 100 },
      done: false,
      due: "2026-12-01",
      owner: null,
      priority: 2,
      ratio: 0.75,
      reviewers: ["Grace", "Linus"],
      status: "draft",
      summary: "line one\n---\nline three",
    },
    published: "2026-10-01",
    site: "notes.example",
    tags: ["work", "launch"],
    title: "Launch plan",
  }),
  folder: ["Projects", "Q4 plans"],
  id: NOTE_ID,
};

const LINK: ExportItem = {
  blocks: [
    ...blocks("note", `My take: it is the [Launch plan](mention:${NOTE_ID}) in a box.`),
    ...blocks("article", "# Smart notes\n\nThe slip-box holds:\n\n- one idea a card\n- links\n"),
  ],
  fields: fieldsOf({
    author: "Sönke Ahrens",
    coverSha: HELD["cover.webp"].sha,
    description: "A book about writing.",
    kind: "link",
    lang: "en",
    published: "2017",
    reading: { at: CODEC_NOW - 2 * DAY, state: "read" },
    site: "Example",
    tags: ["reading"],
    title: "How to take smart notes",
    url: "https://example.com/smart-notes",
  }),
  folder: ["Reading"],
  id: LINK_ID,
};

const DECK: ExportItem = {
  blocks: blocks("note", "Notes on the deck."),
  fields: fieldsOf({
    kind: "pdf",
    originalName: "Board deck 2026.pdf",
    originalSha: HELD["deck.pdf"].sha,
    title: "Board deck 2026",
  }),
  folder: [],
  id: DECK_ID,
};

const BOARD: ExportItem = {
  blocks: [],
  fields: fieldsOf({
    coverSha: HELD["whiteboard.png"].sha,
    kind: "image",
    originalName: "whiteboard.png",
    originalSha: HELD["whiteboard.png"].sha,
    title: "whiteboard",
  }),
  folder: ["Projects"],
  id: BOARD_ID,
};

const GONE: ExportItem = {
  blocks: [],
  fields: fieldsOf({
    kind: "link",
    reading: { at: CODEC_NOW - DAY, error: "The page could not be reached.", state: "failed" },
    title: "",
    url: "https://example.com/gone",
  }),
  folder: ["Reading"],
  id: GONE_ID,
};

const TALK: ExportItem = {
  blocks: [],
  fields: fieldsOf({
    kind: "video",
    reading: { at: null, state: "pending" },
    title: "A talk on slip-boxes",
    url: "https://video.example/watch?v=slipbox#t=30",
  }),
  folder: ["Reading"],
  id: TALK_ID,
};

const TWIN: ExportItem = {
  blocks: blocks("note", "The other one."),
  fields: fieldsOf({ title: "launch plan" }),
  folder: ["Projects", "Q4 plans"],
  id: TWIN_ID,
};

const ODD: ExportItem = {
  blocks: blocks("note", "Odd."),
  fields: fieldsOf({ title: "Q3: results / next?" }),
  folder: [".hidden", "__MACOSX"],
  id: ODD_ID,
};

const LIBRARY = [NOTE, LINK, DECK, BOARD, GONE, TALK, TWIN, ODD];

const typeOf = (sha: string) =>
  (Object.values(HELD).find((file) => file.sha === sha)?.type ??
    UNKNOWN_FILE_TYPE) satisfies string;

const PORTS: ExportPorts = {
  title: (itemId) => LIBRARY.find((item) => item.id === itemId)?.fields.title ?? null,
  typeOf,
};

const exported = (items: readonly ExportItem[]) =>
  items.map(exportWriter(PORTS)) satisfies ExportedFile[];

let planned = 0;

const IDS: PlanIds = {
  newItemId: () => {
    planned += 1;

    return `0195f3a0-5c1e-7000-8000-${String(planned).padStart(12, "0")}`;
  },
};

const entriesOf = (files: readonly ExportedFile[]) => {
  const bytes = new Map(files.flatMap((file) => file.files.map((held) => [held.path, held.sha])));

  return [
    ...files.map(
      (file) => ({ kind: "doc", path: file.path, text: file.text }) satisfies ImportEntry,
    ),
    ...[...bytes].map(([path, sha]) => ({ kind: "file", path, sha }) satisfies ImportEntry),
  ] satisfies ImportEntry[];
};

interface Reimported {
  readonly path: string;
  readonly itemId: string;
  readonly item: ImportedItem;
}

const reimport = (files: readonly ExportedFile[]) => {
  const plan = planImport(entriesOf(files), IDS);
  const reader = openPlan(plan);

  return plan.docs.map((doc) => {
    const text = files.find((file) => file.path === doc.path)?.text ?? "";
    const read = importPlannedDoc(reader, doc, text, { newBlockId, now: CODEC_NOW });

    if (!read.ok) {
      throw new Error(`the import refused ${doc.path}: ${read.reason.kind}`);
    }

    return { item: read.read.item, itemId: doc.itemId, path: doc.path };
  }) satisfies Reimported[];
};

const landed = (item: ExportItem) => ({
  blocks: item.blocks.map((body) => ({ ...body, block: withoutId(body.block) })),
  fields: importedFields({
    ...item.fields,
    pinnedAt: item.fields.pinnedAt === null ? null : item.fields.savedAt,
  }),
  leftOut: 0,
});

const contentOf = (item: ImportedItem) => ({
  blocks: item.blocks.map((body) => ({ ...body, block: withoutId(body.block) })),
  fields: item.fields,
  leftOut: item.leftOut,
});

const exportedOf = (files: readonly ExportedFile[], id: string) => {
  const file = files.find(
    (one) => one.text.includes(`\nid: ${id}\n`) || one.text.startsWith(`---\nid: ${id}\n`),
  );

  if (file === undefined) {
    throw new Error(`no file carries ${id}`);
  }

  return file satisfies ExportedFile;
};

describe("an export read back by the import is the same library", () => {
  const files = exported(LIBRARY);
  const back = reimport(files);

  it.each(LIBRARY.flatMap((item) => (item === ODD ? [] : [[item.fields.title, item] as const])))(
    "%j: the same fields, folder, body and links",
    (_title, item) => {
      const read = back.find((one) => one.itemId === item.id);
      expect(read?.path).toBe(exportedOf(files, item.id).path);
      expect(dirnamePath(read?.path ?? "")).toBe(item.folder.join("/"));
      expect(read === undefined ? null : contentOf(read.item)).toStrictEqual(
        landed(
          item === NOTE ? { ...item, blocks: blocks("note", noteBody("The old plan")) } : item,
        ),
      );
    },
  );

  it("writes every item's file where the import reads a note, and every file where it reads one", () => {
    for (const file of files) {
      expect(importPathKind(file.path)).toBe("doc");

      for (const held of file.files) {
        expect(importPathKind(held.path)).toBe("file");
      }
    }
  });

  it("holds every file the library's items hold, and lands none as an item of its own", () => {
    const written = new Set(files.flatMap((file) => file.files.map((held) => held.sha)));
    expect(written).toStrictEqual(new Set(LIBRARY.flatMap(heldShas)));
    const attached = new Set(back.flatMap(({ item }) => heldShas(item)));
    const originals = new Set(back.flatMap(({ item }) => item.fields.originalSha ?? []));
    const plan = planImport(entriesOf(files), IDS);
    expect(planFileItems(plan, { attached, originals }, IDS, CODEC_NOW)).toStrictEqual([]);
  });

  it("names each file for what the item calls it, with an extension of its bytes' type", () => {
    const paths = files.flatMap((file) => file.files.map((held) => held.path));
    expect(paths).toStrictEqual(
      expect.arrayContaining([
        `assets/${"a".repeat(16)}/Image.jpg`,
        `assets/${"b".repeat(16)}/Q3 report.pdf`,
        `assets/covers/${HELD["cover.webp"].sha}.webp`,
        `assets/${"d".repeat(16)}/Board deck 2026.pdf`,
        `assets/${"e".repeat(16)}/whiteboard.png`,
        `assets/${"f".repeat(16)}/Video.mp4`,
      ]),
    );
    expect(exportedOf(files, NOTE_ID).text).toContain(
      `![The team](../../assets/${"a".repeat(16)}/Image.jpg)`,
    );
  });

  it("tells a title another item's file goes by apart, case aside, and says the title", () => {
    const twin = exportedOf(files, TWIN_ID);
    expect(twin.path).toBe("Projects/Q4 plans/launch plan 2.md");
    expect(twin.text).toContain("\ntitle: launch plan\n");
    expect(exportedOf(files, NOTE_ID).text).not.toContain("\ntitle:");
  });

  it("names a file a disk takes, its folders too, and keeps the title as written", () => {
    const odd = exportedOf(files, ODD_ID);
    expect(odd.path).toBe("hidden/__MACOSX (folder)/Q3 - results - next.md");
    const read = back.find((one) => one.itemId === ODD_ID);
    expect(read?.item.fields.title).toBe("Q3: results / next?");
    expect(read === undefined ? null : contentOf(read.item).blocks).toStrictEqual(
      landed(ODD).blocks,
    );
  });

  it("names an unread address's file as its card does, and keeps it untitled", () => {
    const gone = exportedOf(files, GONE_ID);
    expect(gone.path).toMatch(/^Reading\/example\.com - gone\.md$/u);
    expect(gone.text).toContain('\ntitle: ""\n');
  });

  it("spells no property it could not read back", () => {
    expect(files.map((file) => file.leftOut)).toStrictEqual(LIBRARY.map(() => 0));
  });
});

const exportedAlone = (fields: Partial<LibraryItemFields>) => {
  const item: ExportItem = { blocks: [], fields: fieldsOf(fields), folder: [], id: NOTE_ID };
  const [file] = exported([item]);

  if (file === undefined) {
    throw new Error("the export wrote nothing");
  }

  const [read] = reimport([file]);

  return { file, item: read?.item };
};

describe("a property no key of the file can spell", () => {
  it("is left out where a field writes its key, or where the import would read it as a field", () => {
    const { file, item } = exportedAlone({
      properties: { id: "mine", kept: "yes", url: "https://example.com/not-mine" },
      title: "Keys",
    });

    expect(file.leftOut).toBe(2);
    expect(file.text.match(/^id:/gmu)).toHaveLength(1);
    expect(file.text).not.toContain("url:");
    expect(item?.fields.url).toBeNull();
    expect(item?.fields.properties).toStrictEqual({ kept: "yes" });
  });

  it("joins a list's own entries where the list's field could not read it", () => {
    const { file, item } = exportedAlone({
      properties: { tags: ["reading list", "2026"] },
      tags: ["work"],
      title: "Lists",
    });

    expect(file.leftOut).toBe(0);
    expect(file.text.match(/^tags:/gmu)).toHaveLength(1);
    expect(item?.fields.tags).toStrictEqual(["work"]);
    expect(item?.fields.properties).toStrictEqual({ tags: ["reading list", "2026"] });
  });
});
