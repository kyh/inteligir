// Saving from the phone: a link is a stub this phone fills (fill-queue.ts), a thought is a note, and
// either is ONE create in Unsorted through the outbox, a link's pending fill queued in the same
// transaction, so a save made offline lists at once and lands, and is read, when the phone is back.
// A link the library already holds answers where it is. Platform-free: the scenario suite runs it
// under node.

import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import { UNSORTED_FOLDER, WEB_URL_RULE } from "@repo/notes/items/item-kind";
import { itemStem } from "@repo/notes/items/item-name";
import { linkStubText } from "@repo/notes/items/item-stub";
import { formatItemTime } from "@repo/notes/items/item-time";
import { cleanUrl, isWebUrl, urlKey } from "@repo/notes/items/item-url";
import { freeDocPath } from "@repo/notes/knowledge/doc-file";
import type { NotesStore } from "../notes/notes-store";
import { linkInText } from "./link-in-text";

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
  store: Pick<NotesStore, "create" | "heldFiles" | "ready" | "saveStub">;
  now: () => Date;
  newId: () => string;
  // a link was saved: its fill is due now
  linkSaved?: () => void;
}

// another write can take the picked name between the pick and the queue; past this the name
// keeps being taken, which is a fault rather than a race (fileOps.create's own bound)
const MAX_NAME_ATTEMPTS = 3;

const NAME_TAKEN = "That name kept being taken. Try again.";

const NOTHING_TO_SAVE = "Type a link or a thought to save.";

const firstLine = (text: string): string =>
  text.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";

export const createItemOps = ({ linkSaved, newId, now, store }: ItemOpsArgs): ItemOps => {
  const holding = (key: string): string | null =>
    store.heldFiles().find((file) => file.item?.facts.urlKey === key)?.path ?? null;

  // the first free name in Unsorted, stepping past a create another write took first; a link's
  // key is looked for again before each try, since the write that took the name may be its own
  // save from another screen. Every lookup waits for the boot to read the phone's rows back, so
  // a share the app opens with is never checked against an empty listing. A link's stub carries
  // its id and its address, which its pending fill is queued under
  const createIn = async (
    stem: string,
    content: string,
    link: { key: string; itemId: string; url: string } | null = null,
  ): Promise<SavedItem> => {
    await store.ready();
    const refused: string[] = [];
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const held = link === null ? null : holding(link.key);
      if (held !== null) {
        return { kind: "already", path: held };
      }
      const taken = [...store.heldFiles().map((file) => file.path), ...refused];
      const path = freeDocPath(UNSORTED_FOLDER, stem, taken);
      const outcome =
        link === null
          ? await store.create(path, content)
          : await store.saveStub(path, content, {
              itemId: link.itemId,
              notBefore: now().getTime(),
              url: link.url,
            });
      if (outcome.kind === "created") {
        if (link !== null) {
          linkSaved?.();
        }
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
    const itemId = newId();
    const text = linkStubText({ id: itemId, note: note ?? "", saved: now().getTime(), url });
    return await createIn(itemStem(title, url), text, {
      itemId,
      key,
      url: cleanUrl(url) ?? url,
    });
  };

  return {
    saveLink,
    async saveText(text) {
      const trimmed = text.trim();
      if (trimmed === "") {
        return { kind: "refused", message: NOTHING_TO_SAVE };
      }
      const link = linkInText(trimmed);
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
