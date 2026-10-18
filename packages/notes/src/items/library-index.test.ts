import { describe, expect, it } from "vitest";

import { LinkGraphIndex } from "../knowledge/link-graph-index";
import { projectDoc } from "../knowledge/projection";
import type { ItemQuery } from "./library-index";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

const iso = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;

const link = (url: string, savedDay: number, extra: readonly string[] = []): string =>
  [
    "---",
    "id: i",
    "kind: link",
    `url: ${url}`,
    `saved: ${iso(T0 + savedDay * DAY)}`,
    ...extra,
    "---",
  ]
    .join("\n")
    .concat("\n");

const query = (overrides: Partial<ItemQuery> = {}): ItemQuery => ({
  limit: 100,
  offset: 0,
  sort: "saved",
  subfolders: true,
  untagged: false,
  ...overrides,
});

const indexOf = (docs: Readonly<Record<string, string>>, others: readonly string[] = []) => {
  const graph = new LinkGraphIndex();
  for (const [path, content] of Object.entries(docs)) {
    graph.applyDoc(path, projectDoc(path, content));
  }
  for (const path of others) {
    graph.setOther(path);
  }
  return graph;
};

const paths = (graph: LinkGraphIndex, overrides: Partial<ItemQuery> = {}): string[] =>
  graph.items(query(overrides)).items.map((row) => row.path);

const library = (): LinkGraphIndex => {
  const graph = indexOf(
    {
      "AGENTS.md": "# Filing rules\n",
      "Reading/Old.md": link("https://a.com/old", 1, ["tags: [reading]"]),
      "Reading/deep/Nested.md": link("https://b.com/nested", 3, ["tags: [reading/deep]"]),
      "Unsorted/File over app.md": link("https://stephango.com/file-over-app", 5),
      "Unsorted/Clip.md": [
        "---",
        "id: v",
        "kind: video",
        "url: https://www.youtube.com/watch?v=x",
        `saved: ${iso(T0 + 4 * DAY)}`,
        "fetched: 2026-10-05T00:00:00Z",
        "---",
        "![](assets/covers/aa.jpg)",
        "",
        "A clip about #cats.",
        "",
      ].join("\n"),
      "notes/Ideas.md": "# Ideas\n\nThinking about #cats and dogs.\n",
      "notes/Pinned.md": "---\npinned: true\n---\nTop of the list.\n",
      "photos/Trip.md": [
        "---",
        "id: p",
        "kind: image",
        `saved: ${iso(T0 + 2 * DAY)}`,
        "---",
        "![](assets/IMG_1.png)",
        "",
      ].join("\n"),
      ".inteligir/hidden.md": "# Hidden\n",
    },
    [
      "assets/IMG_1.png",
      "assets/covers/aa.jpg",
      "assets/pages/aa.html",
      "loose/scan.pdf",
      "loose/archive.zip",
      "loose/song.mp3",
    ],
  );
  graph.setStat("notes/Ideas.md", { mtimeMs: T0 + 6 * DAY, size: 40 });
  graph.setStat("notes/Pinned.md", { mtimeMs: T0, size: 30 });
  graph.setStat("loose/scan.pdf", { mtimeMs: T0 + 0.5 * DAY, size: 1234 });
  graph.setStat("loose/song.mp3", { mtimeMs: T0 + 7 * DAY, size: 99 });
  graph.setStat("assets/IMG_1.png", { mtimeMs: T0, size: 5000 });
  return graph;
};

describe("the library's members", () => {
  it("lists every doc and bare media file, never the hidden paths or a referenced file", () => {
    expect(paths(library()).toSorted()).toEqual([
      "Reading/Old.md",
      "Reading/deep/Nested.md",
      "Unsorted/Clip.md",
      "Unsorted/File over app.md",
      "loose/scan.pdf",
      "loose/song.mp3",
      "notes/Ideas.md",
      "notes/Pinned.md",
      "photos/Trip.md",
    ]);
  });

  it("answers a bare file's row from the file itself", () => {
    const [scan] = library().itemsAt(["loose/scan.pdf"]);
    expect(scan).toMatchObject({
      bare: true,
      cover: null,
      file: "loose/scan.pdf",
      fileBytes: 1234,
      kind: "pdf",
      modifiedMs: T0 + 0.5 * DAY,
      title: "scan",
      url: null,
    });
  });

  it("reads a doc's row: facts, files, tags and preview", () => {
    const [clip, trip] = library().itemsAt(["Unsorted/Clip.md", "photos/Trip.md", "AGENTS.md"]);
    expect(clip).toMatchObject({
      bare: false,
      cover: "assets/covers/aa.jpg",
      fetched: "2026-10-05T00:00:00Z",
      folder: "Unsorted",
      host: "youtube.com",
      kind: "video",
      pending: false,
      preview: "A clip about #cats.",
      saved: iso(T0 + 4 * DAY),
      tags: [],
      title: "Clip",
    });
    expect(trip).toMatchObject({ cover: "assets/IMG_1.png", file: "assets/IMG_1.png" });
    expect(trip?.fileBytes).toBe(5000);
    expect(library().itemsAt(["AGENTS.md", "assets/IMG_1.png"])).toEqual([]);
  });

  it("makes a file bare again when the last doc naming it lets go, by path or by name", () => {
    const graph = indexOf({ "a.md": "![](pic.png)\n", "b.md": "![[pic.png]]\n" }, ["pic.png"]);
    expect(paths(graph)).not.toContain("pic.png");
    graph.applyDoc("a.md", projectDoc("a.md", "nothing\n"));
    expect(paths(graph)).not.toContain("pic.png");
    graph.remove("b.md");
    expect(paths(graph)).toContain("pic.png");
    graph.applyDoc("c.md", projectDoc("c.md", "![](./pic.png)\n"));
    expect(paths(graph)).not.toContain("pic.png");
  });
});

describe("the sorts", () => {
  it("puts pinned first, then saved newest first, a doc without saved by its mtime", () => {
    expect(paths(library())).toEqual([
      "notes/Pinned.md",
      "loose/song.mp3",
      "notes/Ideas.md",
      "Unsorted/File over app.md",
      "Unsorted/Clip.md",
      "Reading/deep/Nested.md",
      "photos/Trip.md",
      "Reading/Old.md",
      "loose/scan.pdf",
    ]);
  });

  it("sorts by mtime, an unstatted item last, and by title", () => {
    expect(paths(library(), { sort: "modified" }).slice(0, 4)).toEqual([
      "notes/Pinned.md",
      "loose/song.mp3",
      "notes/Ideas.md",
      "loose/scan.pdf",
    ]);
    expect(paths(library(), { sort: "title" })).toEqual([
      "notes/Pinned.md",
      "Unsorted/Clip.md",
      "Unsorted/File over app.md",
      "notes/Ideas.md",
      "Reading/deep/Nested.md",
      "Reading/Old.md",
      "loose/scan.pdf",
      "loose/song.mp3",
      "photos/Trip.md",
    ]);
  });

  it("orders a search's hits by rank, pinned first, and relevance without hits as saved", () => {
    const within = new Map([
      ["Reading/Old.md", 0],
      ["notes/Ideas.md", 1],
      ["notes/Pinned.md", 2],
      ["missing.md", 3],
    ]);
    expect(paths(library(), { sort: "relevance", within })).toEqual([
      "notes/Pinned.md",
      "Reading/Old.md",
      "notes/Ideas.md",
    ]);
    expect(paths(library(), { sort: "relevance" })).toEqual(paths(library()));
  });

  it("pages stably, and re-sorts after a change to a sort's key", () => {
    const graph = library();
    const whole = paths(graph);
    const pages = [0, 3, 6].flatMap((offset) => paths(graph, { limit: 3, offset }));
    expect(pages).toEqual(whole);
    graph.applyDoc("Reading/Old.md", projectDoc("Reading/Old.md", link("https://a.com/old", 9)));
    expect(paths(graph)[1]).toBe("Reading/Old.md");
    graph.setStat("loose/scan.pdf", { mtimeMs: T0 + 30 * DAY, size: 1234 });
    expect(paths(graph)[1]).toBe("loose/scan.pdf");
    graph.applyDoc("photos/Trip.md", projectDoc("photos/Trip.md", "---\npinned: true\n---\n"));
    expect(paths(graph).slice(0, 2).toSorted()).toEqual(["notes/Pinned.md", "photos/Trip.md"]);
  });
});

describe("the filters", () => {
  it("narrows by kinds, counting every kind of the scope whatever kinds were asked", () => {
    const page = library().items(query({ kinds: ["video", "pdf"] }));
    expect(page.items.map((row) => row.path)).toEqual(["Unsorted/Clip.md", "loose/scan.pdf"]);
    expect(page.total).toBe(2);
    expect(page.kindCounts).toEqual({
      audio: 1,
      file: 0,
      image: 1,
      link: 3,
      note: 2,
      pdf: 1,
      video: 1,
    });
  });

  it("narrows by folder, with or without its subfolders, the root included", () => {
    expect(paths(library(), { folder: "Reading" })).toEqual([
      "Reading/deep/Nested.md",
      "Reading/Old.md",
    ]);
    expect(paths(library(), { folder: "Reading", subfolders: false })).toEqual(["Reading/Old.md"]);
    expect(paths(library(), { folder: "" })).toHaveLength(9);
    expect(paths(library(), { folder: "", subfolders: false })).toEqual([]);
    const counted = library().items(query({ folder: "Reading", kinds: ["note"] }));
    expect(counted.kindCounts.link).toBe(2);
    expect(counted.total).toBe(0);
  });

  it("narrows by a tag's family, by untagged, by site and by saved date", () => {
    expect(paths(library(), { tag: "reading" })).toEqual([
      "Reading/deep/Nested.md",
      "Reading/Old.md",
    ]);
    expect(paths(library(), { tag: "cats" })).toEqual(["notes/Ideas.md"]);
    expect(paths(library(), { untagged: true })).not.toContain("Reading/Old.md");
    expect(paths(library(), { untagged: true })).toContain("loose/scan.pdf");
    expect(paths(library(), { site: "youtube.com" })).toEqual(["Unsorted/Clip.md"]);
    expect(paths(library(), { site: "https://www.stephango.com/" })).toEqual([
      "Unsorted/File over app.md",
    ]);
    expect(paths(library(), { sinceMs: T0 + 4 * DAY })).toEqual([
      "loose/song.mp3",
      "notes/Ideas.md",
      "Unsorted/File over app.md",
      "Unsorted/Clip.md",
    ]);
  });

  it("takes only a note's own text as tags; a saved page's hashtags are not", () => {
    const [clip] = library().itemsAt(["Unsorted/Clip.md"]);
    expect(clip?.tags).toEqual([]);
  });

  it("answers the same paths and total as the items", () => {
    const graph = library();
    const asked = query({ folder: "Unsorted", limit: 1 });
    expect(graph.itemPaths(asked)).toEqual({ paths: ["Unsorted/File over app.md"], total: 2 });
  });
});

describe("findByUrl", () => {
  it("finds every item holding a url's key, a filled one before a stub, then the earliest", () => {
    const graph = indexOf({
      "a.md": link("https://stephango.com/file-over-app?utm_source=x", 3),
      "b.md": link("https://www.stephango.com/file-over-app/", 2),
      "a 2.md": `${link("https://stephango.com/file-over-app", 4).replace("---\n", "---\nfetched: 2026-10-06T00:00:00Z\n")}`,
      "other.md": link("https://stephango.com/other", 1),
    });
    const found = graph.findByUrl("http://stephango.com/file-over-app#top", 10);
    expect(found.key).toBe("stephango.com/file-over-app");
    expect(found.items.map((row) => row.path)).toEqual(["a 2.md", "b.md", "a.md"]);
    expect(graph.findByUrl("not a url", 10)).toEqual({ items: [], key: null });
    expect(graph.findByUrl("https://stephango.com/file-over-app", 1).items).toHaveLength(1);
  });

  it("follows a move and an edit of the url", () => {
    const graph = indexOf({ "a.md": link("https://a.com/x", 1) });
    graph.remove("a.md");
    graph.applyDoc("b.md", projectDoc("b.md", link("https://a.com/x", 1)));
    expect(graph.findByUrl("https://a.com/x", 5).items.map((row) => row.path)).toEqual(["b.md"]);
    graph.applyDoc("b.md", projectDoc("b.md", link("https://a.com/y", 1)));
    expect(graph.findByUrl("https://a.com/x", 5).items).toEqual([]);
  });
});

describe("scopes and stubs", () => {
  it("counts the scopes, and lists the folders parents first, the hidden ones left out", () => {
    const scopes = library().scopes(
      ["empty", "Reading/deep", "assets/covers"],
      ["assets", "Unsorted"],
    );
    expect(scopes).toEqual({
      folders: [
        { items: 0, path: "empty" },
        { items: 2, path: "loose" },
        { items: 2, path: "notes" },
        { items: 1, path: "photos" },
        { items: 2, path: "Reading" },
        { items: 1, path: "Reading/deep" },
      ],
      total: 9,
      unsorted: 2,
      untagged: 6,
    });
  });

  it("lists the stubs, the earliest saved first", () => {
    expect(library().itemStubs()).toEqual([
      "Reading/Old.md",
      "Reading/deep/Nested.md",
      "Unsorted/File over app.md",
    ]);
  });
});
