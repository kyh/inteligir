import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TElement } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { blockOfElement } from "@repo/editor/headless/body/element-block";

import { generateDoc } from "./markdown-doc-generator.test-utils";
import { readValue } from "./markdown-meaning.test-utils";

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));

const UNSPELLED: TElement[] = [
  { children: [{ text: "" }], sha: "a".repeat(64), type: "img" },
  { children: [{ text: "" }], sha: "b".repeat(64), type: "video" },
  { children: [{ text: "" }], name: "deck.pdf", sha: "c".repeat(64), type: "file" },
  {
    children: [{ text: "" }],
    title: "a title",
    type: "img",
    url: "https://example.com/a.png",
    width: 320,
  },
  {
    children: [
      { text: "under", underline: true },
      {
        children: [{ text: "" }],
        display: "3",
        name: "sum",
        source: "1 + 2",
        type: "formulaPill",
      },
    ],
    type: "p",
  },
  {
    children: [
      { children: [{ children: [{ text: "left" }], type: "p" }], type: "column", width: "40%" },
      { children: [{ children: [{ text: "right" }], type: "p" }], type: "column", width: "60%" },
    ],
    type: "column_group",
  },
  { children: [{ text: "four" }], type: "h4" },
  { children: [{ text: "five" }], type: "h5" },
  { children: [{ text: "six" }], type: "h6" },
];

const LIST_PROPS = {
  checked: true,
  indent: 2,
  listRestart: 3,
  listRestartPolite: 3,
  listStart: 3,
  listStyleType: "todo",
} as const;

const stored = (elements: readonly TElement[], from: string) =>
  elements.map((element, index) => {
    const block = blockOfElement({ ...element, id: `${from}-${String(index)}` });

    if (block === null) {
      throw new Error(`${from} holds a block no store takes: ${element.type}`);
    }

    return block;
  });

const FILES: TElement[] = (["corpus", "frontmatter"] as const).flatMap((dir) =>
  readdirSync(`${FIXTURES}${dir}`)
    .toSorted()
    .flatMap((file) => readValue(readFileSync(`${FIXTURES}${dir}/${file}`, "utf-8"))),
);

const GENERATED: TElement[] = Array.from({ length: 20 }, (_, seed) =>
  readValue(generateDoc(seed)),
).flat();

const withListProps = (elements: readonly TElement[]) =>
  [...new Map(elements.map((element) => [element.type, element])).values()].flatMap((element) =>
    [
      { ...element, ...LIST_PROPS },
      { ...element, indent: 1 },
    ]
      .filter((decorated) => storableBlockSchema.safeParse({ ...decorated, id: "x" }).success)
      .slice(0, 1),
  );

export const LISTED: LibraryBlock[] = stored(
  withListProps([...FILES, ...GENERATED, ...UNSPELLED]),
  "listed",
);

export const CORPUS: LibraryBlock[] = [
  ...stored(FILES, "file"),
  ...stored(GENERATED, "gen"),
  ...stored(UNSPELLED, "unspelled"),
  ...LISTED,
];

export const SECTIONED: BodyBlock[] = CORPUS.map((block, index) => ({
  block,
  section: index % 3 === 0 ? "article" : "note",
}));
