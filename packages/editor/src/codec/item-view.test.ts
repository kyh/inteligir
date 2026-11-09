import { describe, expect, it } from "vitest";
import { NodeApi } from "platejs";
import type { TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type {
  LibraryBlock,
  LibraryNode,
  LibrarySection,
} from "@repo/contract/library/library-nodes";

import { parseMarkdownSections } from "../markdown/markdown-doc";
import { editItemView } from "./item-edit";
import type { EditPorts } from "./item-edit";
import { itemView, viewPage } from "./item-view";

const line = (text: string): LibraryNode => ({ children: [{ text }], type: "p" });

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const bullet = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  indent: 1,
  listStyleType: "disc",
  type: "p",
});

const toggle = (id: string): LibraryBlock => ({
  children: [line("Summary"), line("hidden")],
  id,
  type: "toggle",
});

const columns = (id: string, inner: LibraryNode[]): LibraryBlock => ({
  children: [
    { children: inner, type: "column" },
    { children: [line("right")], type: "column" },
  ],
  id,
  type: "column_group",
});

const stored = (block: LibraryBlock, section: LibrarySection): BodyBlock => ({ block, section });

const VIEW_PORTS = { title: () => null };

const editPorts = (): EditPorts => {
  let minted = 0;
  return {
    fileKind: () => null,
    itemByTitle: () => null,
    newBlockId: () => {
      minted += 1;
      return `new${String(minted)}`;
    },
    title: () => null,
  };
};

const words = (blocks: readonly TElement[] | null): string[] =>
  (blocks ?? []).map((block) => `${block.type}:${NodeApi.string(block)}`);

const sectionsOf = (md: string) => {
  const read = parseMarkdownSections(md);
  if (!read.ok) {
    throw new Error(`the view did not read: ${read.reason.kind}`);
  }
  return { article: words(read.sections.article), note: words(read.sections.note) };
};

const withPage = (page: LibraryBlock): BodyBlock[] => [
  stored(paragraph("n1", "my note"), "note"),
  stored(page, "article"),
  stored(paragraph("a2", "after it"), "article"),
];

describe("the article's fence", () => {
  it.each([
    ["a paragraph", paragraph("a1", "words"), ":::article", "p:words"],
    ["a toggle", toggle("a1"), "::::article", "toggle:Summaryhidden"],
    ["columns", columns("a1", [line("left")]), ":::::article", "column_group:leftright"],
    [
      "a toggle in a column",
      columns("a1", [{ children: [line("Summary"), line("hidden")], type: "toggle" }]),
      "::::::article",
      "column_group:Summaryhiddenright",
    ],
  ])("outgrows every fence in a page holding %s", (_name, page, opening, read) => {
    const view = itemView(withPage(page), VIEW_PORTS);
    expect(view.markdown.split("\n")).toContain(opening);
    expect(sectionsOf(view.markdown)).toStrictEqual({
      article: [read, "p:after it"],
      note: ["p:my note"],
    });
  });

  it("holds a page with no note before it", () => {
    const view = itemView([stored(toggle("a1"), "article")], VIEW_PORTS);
    expect(view.markdown.startsWith("::::article\n")).toBe(true);
    expect(sectionsOf(view.markdown)).toStrictEqual({
      article: ["toggle:Summaryhidden"],
      note: [],
    });
  });

  it("opens and closes a page of the article's blocks, so it reads as the page it is", () => {
    const view = itemView(withPage(toggle("a1")), VIEW_PORTS);
    const page = viewPage(view, 1, 1);
    expect(page).toMatchObject({ from: 1, to: 2, total: 3 });
    expect(sectionsOf(page.markdown)).toStrictEqual({
      article: ["toggle:Summaryhidden"],
      note: [],
    });
  });

  it("lands an edit inside a container in the article on that block", () => {
    const blocks = withPage(toggle("a1"));
    const outcome = editItemView(
      blocks,
      [{ newText: "hidden, edited", oldText: "hidden" }],
      editPorts(),
    );
    expect(outcome).toMatchObject({
      kind: "changed",
      changes: [{ block: { id: "a1", type: "toggle" }, kind: "put" }],
    });
    expect(JSON.stringify(outcome)).toContain("hidden, edited");
  });
});

describe("a list run", () => {
  it.each([1, 2])("holds a block nested under it at indent %i as one group", (indent) => {
    const view = itemView(
      [
        stored(bullet("a1", "one"), "note"),
        stored(
          {
            children: [{ children: [{ text: "x" }], type: "code_line" }],
            id: "a2",
            indent,
            type: "code_block",
          },
          "note",
        ),
        stored(bullet("a3", "two"), "note"),
      ],
      VIEW_PORTS,
    );
    expect(new Set(view.blocks.map((block) => block.group)).size).toBe(1);
    expect(sectionsOf(view.markdown).note).toStrictEqual(["p:one", "code_block:x", "p:two"]);
  });
});
