// A library lookup read in one round of queries, for a caller whose library answers by query and
// not at once: the codec runs over what is already known, every title, item and file it asks
// beyond that recorded and answered as none, the caller reads those asks in one round, and the
// codec runs again over the answers alone. One round is enough because a run asks nothing the
// first run did not, but the title of an item a title named, which the title's answer carries.
// Each door's suite holds that: `one-round-lookup.test.ts`.

import type { FileKind } from "@repo/contract/items/item-kind";
import { titleKey } from "@repo/contract/library/derive-item";

import type { LibraryLookup } from "./library-links";

export interface LookupAsks {
  // each title as the library files it (`titleKey`), never empty
  readonly titleKeys: ReadonlySet<string>;
  readonly itemIds: ReadonlySet<string>;
  readonly shas: ReadonlySet<string>;
}

// what the library answers, each ask of a round among them: a title key the one live item filed
// under it, by its title or an alias, with the title a link to it shows; null where none or
// several are
export interface LookupAnswers {
  readonly titled: ReadonlyMap<string, { readonly itemId: string; readonly title: string } | null>;
  // an item's title as a link to it shows; null for an id no item holds
  readonly titles: ReadonlyMap<string, string | null>;
  readonly fileKinds: ReadonlyMap<string, FileKind | null>;
}

interface Asked {
  readonly titleKeys: Set<string>;
  readonly itemIds: Set<string>;
  readonly shas: Set<string>;
}

const noAsks = (): Asked => ({ itemIds: new Set(), shas: new Set(), titleKeys: new Set() });

const NO_ANSWERS: LookupAnswers = { fileKinds: new Map(), titled: new Map(), titles: new Map() };

// answers from `answers` alone, each ask they hold no answer to recorded and answered as none
const answering = (answers: LookupAnswers, asked: Asked): LibraryLookup => {
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
  };
};

const joined = (known: LookupAnswers, read: LookupAnswers): LookupAnswers => ({
  fileKinds: new Map([...known.fileKinds, ...read.fileKinds]),
  titled: new Map([...known.titled, ...read.titled]),
  titles: new Map([...known.titles, ...read.titles]),
});

// `read` run on the library's answers, read in one round. `known`: what the caller read before,
// which the first run answers from (an edit's view, so the text it matches is the one its writer
// read). `unanswered`: what the second run asked beyond the round, which a codec that keeps the
// one-round rule never does, answered as none
export const readInOneRound = async <T>(
  read: (lookup: LibraryLookup) => T,
  answer: (asks: LookupAsks) => Promise<LookupAnswers>,
  known: LookupAnswers = NO_ANSWERS,
): Promise<{ readonly value: T; readonly unanswered: LookupAsks }> => {
  const asked = noAsks();
  const first = read(answering(known, asked));
  // a run that asked nothing beyond `known` is what a second run over the same answers would be
  if (asked.titleKeys.size + asked.itemIds.size + asked.shas.size === 0) {
    return { unanswered: asked, value: first };
  }
  const answers = joined(known, await answer(asked));
  const unanswered = noAsks();
  return { unanswered, value: read(answering(answers, unanswered)) };
};
