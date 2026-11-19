import type { FileKind } from "@repo/contract/items/item-kind";
import { titleKey } from "@repo/contract/library/derive-item";

import type { LibraryLookup } from "./library-links";

export interface LookupAsks {
  readonly titleKeys: ReadonlySet<string>;
  readonly itemIds: ReadonlySet<string>;
  readonly shas: ReadonlySet<string>;
}

export interface LookupAnswers {
  readonly titled: ReadonlyMap<string, { readonly itemId: string; readonly title: string } | null>;
  readonly titles: ReadonlyMap<string, string | null>;
  readonly fileKinds: ReadonlyMap<string, FileKind | null>;
}

interface Asked {
  readonly titleKeys: Set<string>;
  readonly itemIds: Set<string>;
  readonly shas: Set<string>;
}

const noAsks = () =>
  ({ itemIds: new Set(), shas: new Set(), titleKeys: new Set() }) satisfies Asked;

const NO_ANSWERS: LookupAnswers = { fileKinds: new Map(), titled: new Map(), titles: new Map() };

const answering = (answers: LookupAnswers, asked: Asked) => {
  const carried = new Map<string, string>();

  for (const held of answers.titled.values()) {
    if (held !== null) {
      carried.set(held.itemId, held.title);
    }
  }

  return {
    fileKind: (sha) => {
      const kind = answers.fileKinds.get(sha);

      if (kind === undefined) {
        asked.shas.add(sha);
      }

      return kind ?? null;
    },
    itemByTitle: (title) => {
      const key = titleKey(title);

      if (key === "") {
        return null;
      }

      const held = answers.titled.get(key);

      if (held === undefined) {
        asked.titleKeys.add(key);
      }

      return held?.itemId ?? null;
    },
    title: (itemId) => {
      if (answers.titles.has(itemId)) {
        return answers.titles.get(itemId) ?? null;
      }

      const title = carried.get(itemId);

      if (title === undefined) {
        asked.itemIds.add(itemId);
      }

      return title ?? null;
    },
  } satisfies LibraryLookup;
};

const joined = (known: LookupAnswers, read: LookupAnswers) =>
  ({
    fileKinds: new Map([...known.fileKinds, ...read.fileKinds]),
    titled: new Map([...known.titled, ...read.titled]),
    titles: new Map([...known.titles, ...read.titles]),
  }) satisfies LookupAnswers;

export const readInOneRound = async <T>(
  read: (lookup: LibraryLookup) => T,
  answer: (asks: LookupAsks) => Promise<LookupAnswers>,
  known: LookupAnswers = NO_ANSWERS,
) => {
  const asked = noAsks();
  const first = read(answering(known, asked));

  if (asked.titleKeys.size + asked.itemIds.size + asked.shas.size === 0) {
    return { unanswered: asked, value: first } satisfies {
      readonly value: T;
      readonly unanswered: LookupAsks;
    };
  }

  const answers = joined(known, await answer(asked));
  const unanswered = noAsks();

  return { unanswered, value: read(answering(answers, unanswered)) } satisfies {
    readonly value: T;
    readonly unanswered: LookupAsks;
  };
};
