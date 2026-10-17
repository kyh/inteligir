import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_STORE_URL } from "@repo/contract/browser/extension-identity";
import { analyzeMarkdown, toCanonical } from "@repo/editor/markdown/markdown-doc";
import { annotationStoreSchema } from "@repo/notes/annotations/store-schema";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import type { ItemQuery, ItemRow } from "@repo/notes/items/library-index";
import { resolveSeedDir } from "../../server/vault/seed-vault";

// asserted here rather than beside the seed: the fixpoint serializer is browser-side.
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const seedDir = path.join(REPO_ROOT, "apps", "cli", "seed");
const storeDir = path.join(seedDir, ".inteligir", "annotations");
const stores = readdirSync(storeDir);
const seedFiles = readdirSync(seedDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) =>
    path.relative(seedDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
  )
  .toSorted();
const docs = seedFiles.filter(isDocPath);
const read = (file: string): string => readFileSync(path.join(seedDir, file), "utf-8");

// what a new person reads as prose; Kitchen Sink is the construct tour, code blocks and all, and
// the Unsorted items are pages and files someone saved
const GUIDES = ["AGENTS.md", "Guides/Getting Started.md", "Welcome.md"];
// the reader keeps a library and never sees the machinery it runs on; a code span opening on
// `inteligir` names the command, where a fence's `inteligir-chart` names a block
const MACHINERY =
  /\b(?:git|repo(?:sitory)?|commit|remote|cli|terminal|command line|vim|script|npx|mcp|coding agent|vault)\b|(?<!`)`inteligir[\s`]|\binteligir command\b/iu;

const machineryLines = (text: string): string[] =>
  text.split("\n").filter((line) => MACHINERY.test(line));

const indexed = (): KnowledgeIndex => {
  const index = new KnowledgeIndex();
  for (const file of seedFiles) {
    if (isDocPath(file)) {
      index.setDoc(file, read(file));
    } else {
      index.setOther(file);
    }
  }
  return index;
};

const listing = (index: KnowledgeIndex, folder?: string): ItemRow[] => {
  const query: ItemQuery = {
    limit: 100,
    offset: 0,
    sort: "saved",
    subfolders: false,
    untagged: false,
  };
  if (folder !== undefined) {
    query.folder = folder;
  }
  return index.items(query).items;
};

describe("seed vault", () => {
  it("ships the starter set", () => {
    expect(seedFiles).toEqual([
      ".inteligir/annotations/1c9a5b76-4e2d-4f4b-9a63-7e1f2b8c0d44.json",
      ".inteligir/annotations/289b54ec-865d-4403-91e0-f3c3c32dff98.json",
      ".inteligir/annotations/a618c388-0d20-4ebe-bcbd-55b9d59094ec.json",
      "AGENTS.md",
      "Guides/Getting Started.md",
      "Guides/Kitchen Sink.md",
      "Unsorted/About Inteligir.md",
      "Unsorted/Inteligir on GitHub.md",
      "Unsorted/Keyboard shortcuts.md",
      "Unsorted/Sample image.md",
      "Welcome.md",
      "assets/covers/5cc7c01eaf794403.jpg",
      "assets/keyboard-shortcuts.pdf",
      "assets/sample-image.png",
    ]);
  });

  it.each(docs)("%s is byte-canonical through the fixpoint", (name) => {
    const raw = read(name);
    expect(toCanonical(raw)).toBe(raw);
    expect(analyzeMarkdown(raw)).toEqual({ kind: "canonical" });
  });

  it.each(GUIDES)("%s speaks to someone keeping a library, not to a developer", (name) => {
    expect(machineryLines(read(name))).toEqual([]);
  });

  // Tidy my library has something to file on the first launch: one of each kind a save makes
  it("waits in Unsorted with a link and its cover, a link without one, a picture and a PDF", () => {
    const rows = listing(indexed(), "Unsorted").map((row) => ({
      cover: row.cover,
      file: row.file,
      kind: row.kind,
      path: row.path,
      pending: row.pending,
    }));
    expect(rows.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      {
        cover: "assets/covers/5cc7c01eaf794403.jpg",
        file: null,
        kind: "link",
        path: "Unsorted/About Inteligir.md",
        pending: false,
      },
      {
        cover: null,
        file: null,
        kind: "link",
        path: "Unsorted/Inteligir on GitHub.md",
        pending: false,
      },
      {
        cover: null,
        file: "assets/keyboard-shortcuts.pdf",
        kind: "pdf",
        path: "Unsorted/Keyboard shortcuts.md",
        pending: false,
      },
      {
        cover: "assets/sample-image.png",
        file: "assets/sample-image.png",
        kind: "image",
        path: "Unsorted/Sample image.md",
        pending: false,
      },
    ]);
    for (const row of rows) {
      const facts = itemFactsOf(read(row.path));
      expect(facts.kind).toBe(row.kind);
      expect(facts.hasId).toBe(true);
      expect(facts.savedMs).not.toBeNull();
      // filled, so no Mac ever reads these pages: a stub is a url item with no `fetched`
      expect(isItemStub(facts)).toBe(false);
    }
  });

  it("leads the library with the pinned Welcome, and lists every item but the filing rules", () => {
    const paths = listing(indexed()).map((row) => row.path);
    expect(paths[0]).toBe("Welcome.md");
    expect(paths.toSorted()).toEqual(docs.filter((doc) => doc !== "AGENTS.md").toSorted());
  });

  it.each(stores)(
    "%s parses under the annotation store schema and is keyed by a shipped item's id",
    (name) => {
      const parsed = annotationStoreSchema.parse(
        JSON.parse(readFileSync(path.join(storeDir, name), "utf-8")),
      );
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
      const owner = docs.find((doc) => frontmatterId(read(doc)) === name.replace(/\.json$/u, ""));
      expect(owner).toBeDefined();
      const text = owner === undefined ? "" : read(owner);
      for (const [id, entry] of Object.entries(parsed)) {
        // each highlight's markers wrap the very words it remembers
        expect(text).toContain(`%%i:${id}:start%%${entry.quote ?? ""}%%i:${id}:end%%`);
      }
      const texts = Object.values(parsed).map((entry) => entry.text);
      expect(texts.flatMap(machineryLines)).toEqual([]);
    },
  );

  it("every referenced asset ships, and no shipped asset is orphaned", () => {
    const shipped = seedFiles.filter((file) => file.startsWith("assets/"));
    const referenced = new Set<string>();
    for (const name of docs) {
      for (const match of read(name).matchAll(/\((?<file>assets\/[^)]+)\)/gu)) {
        const file = match.groups?.file;
        if (file !== undefined) {
          referenced.add(file);
        }
      }
    }
    expect([...referenced].toSorted()).toEqual(shipped);
  });

  // a link that leads nowhere draws dashed, and a new user reads every one of these notes
  it("resolves every link but Kitchen Sink's deliberately dashed one", () => {
    const index = indexed();
    const dangling = docs.flatMap((file) =>
      index
        .forwardLinks(file)
        .filter((link) => link.targetPath === null)
        .map((link) => ({ sourcePath: file, target: link.target })),
    );
    expect(dangling).toEqual([{ sourcePath: "Guides/Kitchen Sink.md", target: "Field Notes" }]);
  });

  // two items on one id would share one annotation store and one `[[Title|uuid]]` identity
  it("gives every item an id of its own", () => {
    const ids = docs.flatMap((name) => {
      const id = frontmatterId(read(name));
      return id === null ? [] : [id];
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  // the store's own address, so the id the owner swaps in once the listing is public reaches them
  it("links the browser extension wherever the starter notes promise it", () => {
    for (const file of ["Welcome.md", "Guides/Getting Started.md"]) {
      expect(read(file), file).toContain(`[Inteligir extension](${EXTENSION_STORE_URL})`);
    }
  });

  it("the resolver finds this same directory from the source layout", () => {
    expect(resolveSeedDir()).toBe(seedDir);
  });
});
