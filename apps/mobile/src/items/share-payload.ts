// What a share from another app asks the phone to save, read from what the share extension handed
// over: a page or a link with its title, or text, which may hold a link of its own. The shared link
// rides along in the text in its own spellings (a trailing slash, a tracker), so every web address
// in the text naming the same page is taken out of what the text says, and what is left is the
// person's words, never lost. Text that still holds an address, or only punctuation, names nothing.
// Pure: the share inbox and the tests read it.

import { urlKey } from "@repo/notes/items/item-url";

interface SharedLink {
  kind: "link";
  url: string;
  title: string | null;
  note: string | null;
}

export type SharedSave = SharedLink | { kind: "text"; text: string } | { kind: "nothing" };

export interface ShareHandoff {
  webUrl: string | null;
  text: string | null;
  meta: Record<string, string> | null;
}

// text this short and on one line can name an unread link (a share from an app that hands the
// page's name as text); anything longer is a note about it
const TITLE_MAX = 120;

const filled = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

// a web address as text writes it: up to the next space
const WEB_TOKEN = /https?:\/\/\S+/giu;

const looksLikeTitle = (text: string): boolean =>
  text.length <= TITLE_MAX &&
  !/[\r\n]/u.test(text) &&
  !/https?:\/\//iu.test(text) &&
  /[\p{L}\p{N}]/u.test(text);

// the text with every spelling of the shared link taken out; null when nothing but punctuation is
// left
const besideLink = (text: string | null, url: string): string | null => {
  if (text === null) {
    return null;
  }
  const key = urlKey(url);
  const left = filled(
    text
      .replaceAll(WEB_TOKEN, (token) => (key !== null && urlKey(token) === key ? "" : token))
      .replaceAll(/[ \t]{2,}/gu, " "),
  );
  return left !== null && /[\p{L}\p{N}]/u.test(left) ? left : null;
};

export const sharedSaveOf = (intent: ShareHandoff): SharedSave => {
  const url = filled(intent.webUrl);
  const text = filled(intent.text);
  if (url === null) {
    return text === null ? { kind: "nothing" } : { kind: "text", text };
  }
  return {
    kind: "link",
    // the link itself often rides along in the text, which says nothing more
    note: besideLink(text, url),
    title: filled(intent.meta?.title) ?? filled(intent.meta?.["og:title"]),
    url,
  };
};

// a link saved unread has no page to name it and keeps the title it is given, so short words beside
// it are that title; a page read names itself, and the same words stay its note
export const unreadLink = (link: SharedLink): SharedLink =>
  link.title === null && link.note !== null && looksLikeTitle(link.note)
    ? { ...link, note: null, title: link.note }
    : link;

// the address the share extension opens the app with to hand a share over:
// `inteligir://dataUrl=<key>`, which is no screen of the app
export const isShareHandoff = (path: string): boolean =>
  /^(?:[a-z][\d+.a-z-]*:\/\/)?\/?dataUrl=/iu.test(path);
