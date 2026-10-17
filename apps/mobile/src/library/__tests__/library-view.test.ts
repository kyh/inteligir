import { composeLinkBody } from "@repo/notes/items/item-body";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import type { ItemFileFields } from "@repo/notes/items/item-frontmatter";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { describe, expect, it } from "vitest";
import type { HeldFile } from "../../notes/notes-store";
import { textFactsOf } from "../../notes/vault-mirror";
import { libraryCardAt, libraryCards, libraryScopes } from "../library-view";
import type { LibraryFilter } from "../library-view";

// a held file as the store lists it: a doc with its card read from its text, anything else bare
const held = (path: string, text: string | null = null): HeldFile => ({
  path,
  ...(text === null ? { aliases: [], item: null, noteId: null } : textFactsOf(path, text)),
});

const link = (fields: ItemFileFields, body = ""): string =>
  composeItemFile({ id: "0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11", kind: "link", ...fields }, body);

const FILLED = link(
  {
    fetched: "2026-10-17T09:12:33Z",
    saved: "2026-10-17T09:12:30Z",
    site: "Steph Ango",
    tags: ["read"],
    url: "https://stephango.com/file-over-app",
  },
  composeLinkBody({
    article: "File over app is a philosophy.",
    copy: "assets/pages/0a1b2c3d4e5f6071.html",
    cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
    note: "",
  }),
);

const FILES: HeldFile[] = [
  held("Unsorted/File over app.md", FILLED),
  held("assets/covers/3f9a0c2b1d4e5f60.jpg"),
  held("assets/pages/0a1b2c3d4e5f6071.html"),
  held(
    "Unsorted/example.org.md",
    link({ saved: "2026-10-18T08:00:00Z", url: "https://example.org/" }),
  ),
  held(
    "Papers/Lecture.md",
    composeItemFile(
      {
        id: "9e64c3df-c1e2-4a4d-8c07-91528f422413",
        kind: "pdf",
        saved: "2026-09-01T10:00:00Z",
        tags: ["school"],
      },
      "![](<assets/Lecture notes.pdf>)\n",
    ),
  ),
  held("assets/Lecture notes.pdf"),
  held("Papers/Reading/Notes.md", "# My notes\n\nOn #read/later things.\n"),
  held("AGENTS.md", "Tag anything about printing #printing.\n"),
  held(".obsidian/workspace.md", "# not an item\n"),
  held(".inteligir/annotations/x.json", '{"a":{}}\n'),
];

const ALL: LibraryFilter = { kinds: new Set(), query: "", scope: { kind: "all" } };

const paths = (filter: Partial<LibraryFilter>): string[] =>
  libraryCards(FILES, { ...ALL, ...filter }).map((card) => card.path);

describe("the phone's library listing", () => {
  it("lists every item newest save first, an item with no save last, and hides what items show", () => {
    expect(paths({})).toStrictEqual([
      "Unsorted/example.org.md",
      "Unsorted/File over app.md",
      "Papers/Lecture.md",
      "Papers/Reading/Notes.md",
    ]);
  });

  it("draws a card from the item's facts, its cover and its original", () => {
    const [pending, filled, pdf, note] = libraryCards(FILES, ALL);
    expect(filled).toStrictEqual({
      cover: "assets/covers/3f9a0c2b1d4e5f60.jpg",
      file: null,
      folder: "Unsorted",
      kind: "link",
      path: "Unsorted/File over app.md",
      pending: false,
      saved: Date.UTC(2026, 9, 17, 9, 12, 30),
      site: "Steph Ango",
      tags: ["read"],
      title: "File over app",
      url: "https://stephango.com/file-over-app",
    });
    expect(pending).toMatchObject({ cover: null, pending: true, site: "example.org" });
    expect(pdf).toMatchObject({ cover: null, file: "assets/Lecture notes.pdf", kind: "pdf" });
    expect(note).toMatchObject({
      kind: "note",
      pending: false,
      saved: null,
      site: null,
      tags: ["read/later"],
    });
  });

  it("narrows by scope, kind and a query over title, site and address", () => {
    expect(paths({ scope: { kind: "unsorted" } })).toStrictEqual([
      "Unsorted/example.org.md",
      "Unsorted/File over app.md",
    ]);
    expect(paths({ scope: { kind: "folder", path: "Papers" } })).toStrictEqual([
      "Papers/Lecture.md",
      "Papers/Reading/Notes.md",
    ]);
    expect(paths({ scope: { kind: "tag", tag: "Read" } })).toStrictEqual([
      "Unsorted/File over app.md",
      "Papers/Reading/Notes.md",
    ]);
    const kinds: ReadonlySet<ItemKind> = new Set(["pdf", "note"]);
    expect(paths({ kinds })).toStrictEqual(["Papers/Lecture.md", "Papers/Reading/Notes.md"]);
    expect(paths({ query: "STEPH" })).toStrictEqual(["Unsorted/File over app.md"]);
    expect(paths({ query: "example.org/" })).toStrictEqual(["Unsorted/example.org.md"]);
    expect(paths({ query: "lecture" })).toStrictEqual(["Papers/Lecture.md"]);
  });

  it("offers the folders a person files into and the tags most used first", () => {
    expect(libraryScopes(FILES)).toStrictEqual({
      folders: ["Papers", "Papers/Reading"],
      tags: [
        { count: 1, tag: "read" },
        { count: 1, tag: "read/later" },
        { count: 1, tag: "school" },
      ],
    });
  });

  it("answers one item's card, and none for a file no card stands for", () => {
    expect(libraryCardAt(FILES, "Papers/Lecture.md")).toMatchObject({ kind: "pdf" });
    expect(libraryCardAt(FILES, "assets/Lecture notes.pdf")).toBeNull();
    expect(libraryCardAt(FILES, "AGENTS.md")).toBeNull();
    expect(libraryCardAt(FILES, "gone.md")).toBeNull();
  });
});
