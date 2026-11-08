// Saving from the phone, through the replica's outbox, so a save made offline lists at once and
// lands when the phone is back: a link is a save the cloud reads (its fill), a thought is a note
// named by its first line, each where the Library's scope saves. A link whose address an item
// already holds answers that item and changes nothing, at once when the replica holds it.
// Platform-free: the suites and the scenario suite run it under node.

import type { LibraryReplica, LinkInput, Made } from "@repo/library-replica/library-replica";
import { WEB_URL_RULE } from "@repo/notes/items/item-kind";
import { isWebUrl } from "@repo/notes/items/item-url";
import { ordsBetween } from "@repo/notes/library/block-order";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { linkInText } from "./link-in-text";

export type SavedItem =
  | { readonly kind: "saved"; readonly made: Made }
  | { readonly kind: "refused"; readonly message: string };

// where a save lands: the scope's folder, or Unsorted
export interface SaveTarget {
  readonly folderId: string | null;
}

const NOTHING_TO_SAVE = "Type a link or a thought to save.";

// a title is one line, and a card's title at most this long
const TITLE_MAX = 120;

const firstLine = (text: string): string =>
  text.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";

// a thought's paragraphs, one block each, in order; each line break inside one kept
const paragraphsOf = (text: string, newBlockId: () => string): LibraryBlock[] =>
  text
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => ({ children: [{ text: paragraph }], id: newBlockId(), type: "p" }));

export interface PhoneSaves {
  readonly saveLink: (
    link: { readonly url: string; readonly title: string | null; readonly note: string | null },
    target: SaveTarget,
  ) => Promise<SavedItem>;
  // a web link inside is saved as that link, the rest of the text its note; any other text is a
  // note named by its first line
  readonly saveText: (text: string, target: SaveTarget) => Promise<SavedItem>;
  // an empty note, its title to be typed
  readonly newNote: (target: SaveTarget) => Promise<Made>;
}

export const createPhoneSaves = (args: {
  readonly replica: LibraryReplica;
  readonly newBlockId: () => string;
}): PhoneSaves => {
  const { replica } = args;

  const saveLink: PhoneSaves["saveLink"] = async ({ note, title, url }, { folderId }) => {
    if (!isWebUrl(url)) {
      return { kind: "refused", message: WEB_URL_RULE };
    }
    const bare: LinkInput = { folderId, tags: [], url };
    const titled: LinkInput = title === null ? bare : { ...bare, title };
    const input: LinkInput = note === null ? titled : { ...titled, note };
    return { kind: "saved", made: await replica.saveLink(input) };
  };

  return {
    newNote: async ({ folderId }) =>
      await replica.createNote({ blocks: [], folderId, tags: [], title: "" }),
    saveLink,
    saveText: async (text, target) => {
      const trimmed = text.trim();
      if (trimmed === "") {
        return { kind: "refused", message: NOTHING_TO_SAVE };
      }
      const link = linkInText(trimmed);
      if (link !== null) {
        return await saveLink(
          { note: link.rest === "" ? null : link.rest, title: null, url: link.url },
          target,
        );
      }
      const blocks = paragraphsOf(trimmed, args.newBlockId);
      const ords = ordsBetween(null, null, blocks.length);
      const made = await replica.createNote({
        blocks: blocks.flatMap((block, index) => {
          const ord = ords[index];
          return ord === undefined ? [] : [{ block, ord, section: "note" as const }];
        }),
        folderId: target.folderId,
        tags: [],
        title: firstLine(trimmed).slice(0, TITLE_MAX),
      });
      return { kind: "saved", made };
    },
  };
};
