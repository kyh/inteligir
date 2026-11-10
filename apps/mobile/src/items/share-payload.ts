// What a share from another app asks the phone to save, read from what the share extension handed
// over: a page or a link with its title, or text, which may hold a link of its own. A page comes
// over as its address and nothing else, the page's own to the last character, whatever it ends in.
// In text, expo-share-intent's search stops an address at a bracket, a comma or an accented letter
// and finds none straight after a bracket or a colon, so the link is read here, where a sentence's
// marks are told from the address's, and text holding one is a link share whatever the search
// found. Every spelling of the link is taken out of what the text says, and what is left is the
// person's words, a new item's note. Only punctuation left is no note.
// Pure: the share inbox, the outbox, the saves and the tests read it.

import { z } from "zod";
import { isWebUrl } from "@repo/contract/items/item-url";
import { fieldLine } from "@repo/contract/items/saved-facts";
import { linkInText, withoutLink } from "./link-in-text";

// a share that holds something to save, as the outbox keeps it and sends it
export const shareSaveSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("link"),
    note: z.string().nullable(),
    title: z.string().nullable(),
    url: z.string(),
  }),
  z.object({ kind: z.literal("text"), text: z.string() }),
]);

export type ShareSave = z.infer<typeof shareSaveSchema>;

export type SharedSave = ShareSave | { kind: "nothing" };

export interface ShareHandoff {
  webUrl: string | null;
  text: string | null;
  meta: Record<string, string> | null;
}

const filled = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

// the text with every spelling of the shared link taken out; null when nothing but punctuation is
// left
const besideLink = (text: string, url: string): string | null => {
  const left = filled(withoutLink(text, url));
  return left !== null && /[\p{L}\p{N}]/u.test(left) ? left : null;
};

export const sharedSaveOf = (intent: ShareHandoff): SharedSave => {
  const handed = filled(intent.webUrl);
  // expo-share-intent's search also answers a bare name that starts with http, such as httpbin.org
  const given = handed !== null && isWebUrl(handed) ? handed : null;
  const text = filled(intent.text);
  const title =
    fieldLine(intent.meta?.title ?? null) ?? fieldLine(intent.meta?.["og:title"] ?? null);
  if (text === null || text === given) {
    return given === null ? { kind: "nothing" } : { kind: "link", note: null, title, url: given };
  }
  const url = linkInText(text)?.url ?? given;
  return url === null
    ? { kind: "text", text }
    : { kind: "link", note: besideLink(text, url), title, url };
};

// the address the share extension opens the app with to hand a share over:
// `inteligir://dataUrl=<key>`, which is no screen of the app
export const isShareHandoff = (path: string): boolean =>
  /^(?:[a-z][\d+.a-z-]*:\/\/)?\/?dataUrl=/iu.test(path);
