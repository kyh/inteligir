// Saving from the phone: a link is a stub its Macs fill, a thought is a note, and either is ONE
// create in Unsorted through the outbox, so a save made offline lists at once and lands when the
// phone is back. A link the library already holds answers where it is. Platform-free: the
// scenario suite runs it under node.

import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import { UNSORTED_FOLDER, WEB_URL_RULE } from "@repo/notes/items/item-kind";
import { itemStem } from "@repo/notes/items/item-name";
import { linkStubText } from "@repo/notes/items/item-stub";
import { formatItemTime } from "@repo/notes/items/item-time";
import { isWebUrl, urlKey } from "@repo/notes/items/item-url";
import { freeDocPath } from "@repo/notes/knowledge/doc-file";
import type { NotesStore } from "../notes/notes-store";

export type SavedItem =
  | { kind: "saved"; path: string }
  | { kind: "already"; path: string }
  | { kind: "refused"; message: string };

export interface ItemOps {
  saveLink: (i: { url: string; title: string | null; note: string | null }) => Promise<SavedItem>;
  // a web link inside is saved as that link, the rest of the text its note; any other text is a
  // note in Unsorted named by its first line
  saveText: (text: string) => Promise<SavedItem>;
}

export interface ItemOpsArgs {
  store: Pick<NotesStore, "create" | "heldFiles">;
  now: () => Date;
  newId: () => string;
}

// another write can take the picked name between the pick and the queue; past this the name
// keeps being taken, which is a fault rather than a race (fileOps.create's own bound)
const MAX_NAME_ATTEMPTS = 3;

const NAME_TAKEN = "That name kept being taken. Try again.";

const NOTHING_TO_SAVE = "Type a link or a thought to save.";

// a link inside typed or shared text, up to the first space; the punctuation a sentence puts after
// a link is the sentence's
const LINK_IN_TEXT = /https?:\/\/[^\s<>"'`]+/iu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/u;

const linkIn = (text: string): { url: string; rest: string } | null => {
  const found = LINK_IN_TEXT.exec(text);
  if (found === null) {
    return null;
  }
  const url = found[0].replace(TRAILING_PUNCTUATION, "");
  if (!isWebUrl(url)) {
    return null;
  }
  // the punctuation after the link goes with it, so the note keeps no stray mark
  const rest = `${text.slice(0, found.index)}${text.slice(found.index + found[0].length)}`.trim();
  return { rest, url };
};

const firstLine = (text: string): string =>
  text.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";

export const createItemOps = ({ newId, now, store }: ItemOpsArgs): ItemOps => {
  // the first free name in Unsorted, stepping past a create another write took first
  const createIn = async (stem: string, content: string): Promise<SavedItem> => {
    const refused: string[] = [];
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const taken = [...store.heldFiles().map((file) => file.path), ...refused];
      const path = freeDocPath(UNSORTED_FOLDER, stem, taken);
      const outcome = await store.create(path, content);
      if (outcome.kind === "created") {
        return { kind: "saved", path };
      }
      refused.push(path);
    }
    return { kind: "refused", message: NAME_TAKEN };
  };

  const saveLink: ItemOps["saveLink"] = async ({ note, title, url }) => {
    const key = isWebUrl(url) ? urlKey(url) : null;
    if (key === null) {
      return { kind: "refused", message: WEB_URL_RULE };
    }
    const held = store.heldFiles().find((file) => file.item?.facts.urlKey === key);
    if (held !== undefined) {
      return { kind: "already", path: held.path };
    }
    const text = linkStubText({ id: newId(), note: note ?? "", saved: now().getTime(), url });
    return await createIn(itemStem(title, url), text);
  };

  return {
    saveLink,
    async saveText(text) {
      const trimmed = text.trim();
      if (trimmed === "") {
        return { kind: "refused", message: NOTHING_TO_SAVE };
      }
      const link = linkIn(trimmed);
      if (link !== null) {
        return await saveLink({
          note: link.rest === "" ? null : link.rest,
          title: null,
          url: link.url,
        });
      }
      const saved = formatItemTime(now().getTime());
      return await createIn(
        itemStem(firstLine(trimmed), null),
        composeItemFile({ saved }, `${trimmed}\n`),
      );
    },
  };
};
