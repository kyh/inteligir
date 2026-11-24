import { describe, expect, it } from "vitest";
import { NodeApi } from "platejs";
import type { TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type {
  LibraryBlock,
  LibraryNode,
  LibrarySection,
} from "@repo/contract/library/library-nodes";

import { parseMarkdownSections } from "./markdown-doc";
import { editItemView } from "../body/item-edit";
import type { EditPorts } from "../body/item-edit";
import { itemView, viewPage } from "./item-view";

const line = (text: string) => ({ children: [{ text }], type: "p" }) satisfies LibraryNode;

const paragraph = (id: string, text: string) =>
  ({
    children: [{ text }],
    id,
    type: "p",
  }) satisfies LibraryBlock;

const bullet = (id: string, text: string) =>
  ({
    children: [{ text }],
    id,
    indent: 1,
    listStyleType: "disc",
    type: "p",
  }) satisfies LibraryBlock;

const toggle = (id: string) =>
  ({
    children: [line("Summary"), line("hidden")],
    id,
    type: "toggle",
  }) satisfies LibraryBlock;

const columns = (id: string, inner: LibraryNode[]) =>
  ({
    children: [
      { children: inner, type: "column" },
      { children: [line("right")], type: "column" },
    ],
    id,
    type: "column_group",
  }) satisfies LibraryBlock;

const stored = (block: LibraryBlock, section: LibrarySection) =>
  ({ block, section }) satisfies BodyBlock;

const VIEW_PORTS = { title: () => null };

const unbounded = (from: number, count: number) => ({
  count,
  from,
  maxChars: Number.POSITIVE_INFINITY,
});

const editPorts = () => {
  let minted = 0;

  return {
    fileKind: () => null,
    itemByTitle: () => null,
    newBlockId: () => {
      minted += 1;

      return `new${String(minted)}`;
    },
    title: () => null,
  } satisfies EditPorts;
};

const words = (blocks: readonly TElement[] | null) =>
  (blocks ?? []).map((block) => `${block.type}:${NodeApi.string(block)}`);

const sectionsOf = (md: string) => {
  const read = parseMarkdownSections(md);

  if (!read.ok) {
    throw new Error(`the view did not read: ${read.reason.kind}`);
  }

  return { article: words(read.sections.article), note: words(read.sections.note) };
};

const withPage = (page: LibraryBlock) =>
  [
    stored(paragraph("n1", "my note"), "note"),
    stored(page, "article"),
    stored(paragraph("a2", "after it"), "article"),
  ] satisfies BodyBlock[];

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
    const page = viewPage(withPage(toggle("a1")), VIEW_PORTS, unbounded(1, 1));
    expect(page).toMatchObject({ from: 1, to: 2, total: 3 });
    expect(sectionsOf(page.markdown)).toStrictEqual({
      article: ["toggle:Summaryhidden"],
      note: [],
    });
  });

  it("turns down an edit of the article, which is the page as it was read", () => {
    expect(
      editItemView(
        withPage(toggle("a1")),
        [{ newText: "hidden, edited", oldText: "hidden" }],
        editPorts(),
      ),
    ).toStrictEqual({ kind: "refused", refusal: { edit: 0, kind: "section" } });
  });
});

const nested = (indent: number) =>
  [
    stored(paragraph("p1", "before"), "note"),
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
    stored(paragraph("p2", "after"), "note"),
  ] satisfies BodyBlock[];

describe("a list run", () => {
  it.each([1, 2])("holds a block nested under it at indent %i as one group", (indent) => {
    const view = itemView(nested(indent), VIEW_PORTS);
    expect(view.groups.map((group) => group.blocks.map((block) => block.id))).toStrictEqual([
      ["p1"],
      ["a1", "a2", "a3"],
      ["p2"],
    ]);

    for (const group of view.groups) {
      expect(view.markdown.slice(group.start, group.start + group.text.length)).toBe(group.text);
    }

    expect(sectionsOf(view.markdown).note).toStrictEqual([
      "p:before",
      "p:one",
      "code_block:x",
      "p:two",
      "p:after",
    ]);
  });

  it("pages a paragraph beside one on its own", () => {
    expect(viewPage(nested(1), VIEW_PORTS, unbounded(4, 1))).toStrictEqual({
      from: 4,
      markdown: "after\n",
      to: 5,
      total: 5,
    });
    expect(viewPage(nested(1), VIEW_PORTS, unbounded(2, 1))).toMatchObject({ from: 1, to: 4 });
  });
});

const linking = (id: string) =>
  stored(
    {
      children: [
        { text: "See " },
        { children: [{ text: "" }], key: id, type: "mention", value: id },
        { text: "." },
      ],
      id: `p-${id}`,
      type: "p",
    },
    "note",
  );

const askingPorts = () => {
  const asked: string[] = [];

  const title = (id: string) => {
    asked.push(id);

    return `Item ${id}`;
  };

  return { asked, ports: { title } };
};

describe("a page under a budget", () => {
  it("ends before the group that would pass it, writing each group once", () => {
    const blocks = ["a", "b", "c", "d", "e"].map(linking);
    const two = viewPage(blocks, askingPorts().ports, unbounded(0, 2));
    const { asked, ports } = askingPorts();
    expect(
      viewPage(blocks, ports, { count: 5, from: 0, maxChars: two.markdown.length }),
    ).toStrictEqual(two);
    expect(asked).toStrictEqual(["a", "b", "c"]);
  });

  it.each([
    ["a note", nested(1)],
    ["a note and a page", withPage(toggle("a1"))],
  ])("measures a page of %s as it writes it, every line and fence", (_name, blocks) => {
    const ends = itemView(blocks, VIEW_PORTS).groups.map(
      (group) => blocks.findIndex(({ block }) => block === group.blocks.at(-1)) + 1,
    );

    for (const [held, to] of ends.entries()) {
      const page = viewPage(blocks, VIEW_PORTS, unbounded(0, to));
      const budget = { count: blocks.length, from: 0, maxChars: page.markdown.length };
      expect(viewPage(blocks, VIEW_PORTS, budget)).toStrictEqual(page);
      const under = viewPage(blocks, VIEW_PORTS, { ...budget, maxChars: budget.maxChars - 1 });
      expect(under.to).toBe(held === 0 ? to : ends[held - 1]);
    }
  });

  it("holds one group alone past it, a list whole with what nests under it", () => {
    const page = viewPage(nested(1), VIEW_PORTS, { count: 5, from: 2, maxChars: 1 });
    expect(page).toMatchObject({ from: 1, to: 4 });
    expect(sectionsOf(page.markdown).note).toStrictEqual(["p:one", "code_block:x", "p:two"]);
  });
});
