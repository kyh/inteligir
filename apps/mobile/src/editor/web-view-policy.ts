// What the note page's web view may load, the one rule over it: the page itself, as the app loads or
// reloads it, and the blank frames the page makes; a web link the person follows opens in Safari,
// and nothing else loads. Expo picks the page's address (the app bundle, an update's folder, or
// the dev server), so the rule reads how a load began rather than matching where it points.

import type { WebViewNavigation } from "react-native-webview";

export type LoadVerdict =
  | { kind: "allow" }
  | { kind: "refuse" }
  // a web link the person followed: Safari opens it, and the web view never leaves the page
  | { kind: "open-outside"; url: string };

type LoadRequest = Pick<WebViewNavigation, "navigationType" | "url"> & {
  readonly isTopFrame: boolean;
};

const isHttpUrl = (url: string): boolean => /^https?:\/\//iu.test(url);

const isFileUrl = (url: string): boolean => /^file:\/\//iu.test(url);

// a child frame the page itself makes: the html block's sandboxed preview, an inert blank
const PAGE_CHILD_FRAMES: ReadonlySet<string> = new Set(["about:blank", "about:srcdoc"]);

// `dev`: the page comes from the dev server, over http, rather than from a file
export const loadVerdict = (request: LoadRequest, dev: boolean): LoadVerdict => {
  const { navigationType, url } = request;
  if (!request.isTopFrame) {
    return PAGE_CHILD_FRAMES.has(url) ? { kind: "allow" } : { kind: "refuse" };
  }
  if (navigationType === "click") {
    return isHttpUrl(url) ? { kind: "open-outside", url } : { kind: "refuse" };
  }
  // a load no person made: the app opening the page, or reloading it after iOS killed it
  const pageLoad = navigationType === "other" || navigationType === "reload";
  return pageLoad && (isFileUrl(url) || (dev && isHttpUrl(url)))
    ? { kind: "allow" }
    : { kind: "refuse" };
};

// window.open and a target=_blank link: never a second web view, only Safari, only for the web
export const openWindowVerdict = (url: string): LoadVerdict =>
  isHttpUrl(url) ? { kind: "open-outside", url } : { kind: "refuse" };
