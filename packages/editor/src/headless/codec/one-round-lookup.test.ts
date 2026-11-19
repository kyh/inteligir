import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import type { FileKind } from "@repo/contract/items/item-kind";
import { deriveBody, titleKey } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";

import { generateDoc } from "../../test-support/markdown-doc-generator.test-utils";
import { editItemView } from "./item-edit";
import type { EditOutcome, ViewEdit } from "./item-edit";
import { itemView } from "./item-view";
import { libraryLinks } from "./library-links";
import type { LibraryLookup } from "./library-links";
import { readInOneRound } from "./one-round-lookup";
import type { LookupAnswers, LookupAsks } from "./one-round-lookup";
import { readBody } from "./read-body";
import type { BodyRead } from "./read-body";

const FIXTURES = fileURLToPath(new URL("../../test-support/fixtures/", import.meta.url));

interface Input {
  readonly name: string;
  readonly md: string;
}

const filesIn = (dir: string) =>
  readdirSync(`${FIXTURES}${dir}`)
    .toSorted()
    .map((file) => ({ md: readFileSync(`${FIXTURES}${dir}/${file}`, "utf-8"), name: file }));

const INPUTS: readonly Input[] = [
  ...filesIn("corpus"),
  ...filesIn("frontmatter"),
  ...filesIn("links"),
  { md: "[[Café]] and [[Café]] and [[CAFÉ]] name one key\n", name: "nfc-nfd" },
  ...[1, 2, 3, 4, 5, 6].map((seed) => ({
    md: generateDoc(seed),
    name: `generated ${String(seed)}`,
  })),
];

interface Holder {
  readonly itemId: string;
  readonly title: string;
}

interface Library {
  readonly name: string;
  readonly holders: (key: string) => readonly Holder[];
  readonly title: (itemId: string) => string | null;
  readonly kind: (sha: string) => FileKind | null;
}

const hex = (text: string) => createHash("sha256").update(text).digest("hex");

const roll = (seed: string, text: string) =>
  Number.parseInt(hex(`${seed}\0${text}`).slice(0, 8), 16) / 0x1_00_00_00_00;

const KINDS: readonly FileKind[] = ["image", "pdf", "video", "audio", "file"];

const kindOf = (seed: string, sha: string) =>
  (KINDS[Number.parseInt(hex(`${seed}k${sha}`).slice(0, 2), 16) % KINDS.length] ??
    "image") satisfies FileKind;

const libraryOf = (seed: string | null) => {
  const filed = new Map<string, string>();

  const file = (holders: Holder[]) => {
    for (const { itemId, title } of holders) {
      filed.set(itemId, title);
    }

    return holders;
  };

  const at = seed ?? "all";

  return {
    holders: (key) => {
      if (key === "") {
        return [];
      }

      const base = hex(`${at}${key}`).slice(0, 12);
      const chance = seed === null ? 0.5 : roll(seed, `t${key}`);

      if (chance < 0.25) {
        return [];
      }

      if (chance < 0.65) {
        return file([{ itemId: `item-${base}`, title: `Card of ${key}` }]);
      }

      if (chance < 0.8) {
        return file([
          { itemId: `item-${base}-a`, title: `A ${key}` },
          { itemId: `item-${base}-b`, title: `B ${key}` },
        ]);
      }

      return file([{ itemId: `alias-${base}`, title: `Aliased as ${key}` }]);
    },
    kind: (sha) => (seed === null || roll(seed, `s${sha}`) < 0.75 ? kindOf(at, sha) : null),
    name: seed === null ? "everything" : `mixed ${seed}`,
    title: (itemId) =>
      filed.get(itemId) ??
      (seed === null || roll(seed, `i${itemId}`) < 0.7 ? `Live ${itemId}` : null),
  } satisfies Library;
};

const LIBRARIES: readonly Library[] = [null, "1", "2", "3", "4"].map(libraryOf);

const atOnce = (library: Library) =>
  ({
    fileKind: (sha) => library.kind(sha),
    itemByTitle: (title) => {
      const holders = library.holders(titleKey(title));

      return holders.length === 1 ? (holders[0]?.itemId ?? null) : null;
    },
    title: (itemId) => library.title(itemId),
  }) satisfies LibraryLookup;

const answerOf = (library: Library) => async (asks: LookupAsks) => {
  const titled = [...asks.titleKeys].map((key) => {
    const holders = library.holders(key);

    return [key, holders.length === 1 ? (holders[0] ?? null) : null] satisfies [
      string,
      Holder | null,
    ];
  });

  return {
    fileKinds: new Map([...asks.shas].map((sha) => [sha, library.kind(sha)])),
    titled: new Map(titled),
    titles: new Map([...asks.itemIds].map((itemId) => [itemId, library.title(itemId)])),
  } satisfies LookupAnswers;
};

const counter = (prefix: string) => {
  let made = 0;

  return (() => {
    made += 1;

    return `${prefix}${String(made)}`;
  }) satisfies () => string;
};

const bodyOf = (md: string) => (lookup: LibraryLookup) => {
  const links = libraryLinks(lookup);

  return readBody(md, { links, newBlockId: counter("b"), wiki: links.wiki });
};

const NAMING: readonly Input[] = INPUTS.filter(({ md }) => {
  let asked = false;

  const ask = () => {
    asked = true;

    return null;
  };

  bodyOf(md)({ fileKind: ask, itemByTitle: ask, title: ask });

  return asked;
});

const EVEN_NAMING = NAMING.filter((_input, index) => index % 2 === 0);

const asksIn = (asks: LookupAsks) => asks.titleKeys.size + asks.itemIds.size + asks.shas.size;

const offBy = async (
  read: (lookup: LibraryLookup) => BodyRead | EditOutcome,
  library: Library,
  known?: LookupAnswers,
) => {
  const expected = read(atOnce(library));
  const { unanswered, value } = await readInOneRound(read, answerOf(library), known);

  if (asksIn(unanswered) > 0) {
    return `asked past the round: ${JSON.stringify([
      ...unanswered.titleKeys,
      ...unanswered.itemIds,
      ...unanswered.shas,
    ])}`;
  }

  return isDeepStrictEqual(value, expected) ? null : "read otherwise";
};

const beforeRenames = (library: Library) =>
  ({
    ...atOnce(library),
    title: (itemId) => {
      const title = library.title(itemId);

      return title === null ? null : `Before rename ${title}`;
    },
  }) satisfies LibraryLookup;

const FRESH_SHA = "30d5f580709c782e8527b488acfe4959b70c4f512f3b165206e251e47889c496";

const editsOver = (view: ReturnType<typeof itemView>, md: string, other: string) => {
  const note = view.markdown.slice(0, view.noteEnd).replace(/\n+$/u, "");

  const passages = view.groups
    .filter((group) => group.section === "note")
    .filter((_group, index, all) => index % Math.max(1, Math.floor(all.length / 3)) === 0)
    .slice(0, 3)
    .map((group, index) => ({
      newText: `${group.text} [[Fresh ${String(index)}]]\n\n![[assets/${FRESH_SHA}]]`,
      oldText: group.text,
    }));

  return [
    [{ newText: md, oldText: "" }],
    ...(note === "" ? [] : [[{ newText: other, oldText: note }]]),
    ...passages.map((passage) => [passage]),
    ...(passages.length > 1 ? [passages] : []),
  ] satisfies ViewEdit[][];
};

describe("a lookup read in one round", () => {
  it.each(NAMING)("reads $name as the library answering each ask at once does", async ({ md }) => {
    const off: string[] = [];

    for (const library of LIBRARIES) {
      const wrong = await offBy(bodyOf(md), library);

      if (wrong !== null) {
        off.push(`over ${library.name}: ${wrong}`);
      }
    }

    expect(off).toStrictEqual([]);
  });

  it.each(
    EVEN_NAMING.map((input, at, all) => ({
      ...input,
      other: all[(at + 1) % all.length]?.md ?? "",
      withArticle: at % 2 === 1,
    })),
  )(
    "reads an agent's edit of $name as one answered at once does, once its view's links are known",
    async ({ md, other, withArticle }) => {
      const off: string[] = [];

      for (const library of LIBRARIES.slice(0, 2)) {
        const stored = libraryLinks(beforeRenames(library));
        const read = readBody(md, { links: stored, newBlockId: counter("s"), wiki: stored.wiki });

        if (!read.ok) {
          continue;
        }

        const split = Math.ceil((read.blocks.length * 2) / 3);

        const blocks: BodyBlock[] = read.blocks.map((block, index) => ({
          block,
          section: withArticle && index >= split ? "article" : "note",
        }));

        const view = itemView(blocks, atOnce(library));

        const linked = deriveBody(blocks).links.flatMap(({ targetId }) =>
          targetId === null ? [] : [targetId],
        );

        const known: LookupAnswers = {
          fileKinds: new Map(),
          titled: new Map(),
          titles: new Map(linked.map((itemId) => [itemId, library.title(itemId)])),
        };

        for (const edits of editsOver(view, md, other)) {
          const edit = (lookup: LibraryLookup) =>
            editItemView(blocks, edits, { ...lookup, newBlockId: counter("n") });

          const wrong = await offBy(edit, library, known);

          if (wrong !== null) {
            off.push(`over ${library.name}, ${String(edits.length)} edits: ${wrong}`);
          }
        }
      }

      expect(off).toStrictEqual([]);
    },
  );
});
