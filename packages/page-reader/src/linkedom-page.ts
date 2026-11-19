import { parseHTML } from "linkedom";

export const parsePage = (html: string) => {
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
