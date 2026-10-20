// a page's html as a document with an <html>, a <head> and a <body> whatever it was handed, through
// linkedom, the DOM a node host reads a page with (the Mac's fill worker, the phone's runtime under
// node); a WebView reads one with its own DOMParser. A fragment, a bare text body or a JSON answer
// served as html still reads as a page. The repair is string-level or one element moved, never a
// re-serialization, so a page nested deeper than linkedom's own recursion still parses.

import { parseHTML } from "linkedom";

export const parsePage = (html: string): Document => {
  const parsed = parseHTML(html).document;
  const document =
    parsed.querySelector("html") === null
      ? parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`).document
      : parsed;
  const root = document.documentElement;
  if (document.querySelector("head") === null) {
    root.prepend(document.createElement("head"));
  }
  if (document.querySelector("body") === null) {
    root.append(document.createElement("body"));
  }
  return document;
};
