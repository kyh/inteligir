// A page's facts and its readable part, the one extraction every host that fills a link runs, over
// linkedom (`./linkedom-page`): the head is read before defuddle strips it, and defuddle finds the
// readable content with no network (`useAsync` off and a fetch that refuses).

import Defuddle from "defuddle";

import { parsePage } from "./linkedom-page";
import type { PageArgs, PageFacts } from "./page-facts";
import { pageFactsOf, readHead } from "./page-meta";
import type { ExtractedMeta } from "./page-meta";

const refuseFetch: typeof fetch = async () =>
  await Promise.reject(new Error("the page reader reaches no network"));

// what the article is read from: the extractor's pick of the page, as html, or, where it gave up,
// the page's own body
type Readable =
  | { readonly kind: "content"; readonly html: string }
  | { readonly kind: "body"; readonly body: HTMLElement };

export interface ExtractedPage {
  readonly facts: PageFacts;
  readonly readable: Readable;
}

const NO_META: ExtractedMeta = {
  author: "",
  description: "",
  domain: "",
  image: "",
  published: "",
  site: "",
  title: "",
};

// Past this nesting the extractor's recursion overflows, after retrying for seconds, and the
// article's parser, which is handed only what the extractor picked, reads by the square of the
// depth; no page a person reads nests anywhere near it.
const EXTRACTOR_DEPTH_MAX = 256;

// the document's deepest nesting, walked with a stack of its own, stopping once past `limit`
const deeperThan = (root: Element, limit: number): boolean => {
  const pending: { element: Element; depth: number }[] = [{ depth: 0, element: root }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.depth > limit) {
      return true;
    }
    for (const child of next.element.children) {
      pending.push({ depth: next.depth + 1, element: child });
    }
  }
  return false;
};

interface Extracted {
  readonly meta: ExtractedMeta;
  readonly readable: Readable;
}

const extracted = (document: Document, url: string): Extracted => {
  const gaveUp: Extracted = { meta: NO_META, readable: { body: document.body, kind: "body" } };
  if (deeperThan(document.documentElement, EXTRACTOR_DEPTH_MAX)) {
    return gaveUp;
  }
  try {
    const result = new Defuddle(document, { fetch: refuseFetch, url, useAsync: false }).parse();
    return { meta: result, readable: { html: result.content, kind: "content" } };
  } catch {
    return gaveUp;
  }
};

export const extractPage = (args: PageArgs): ExtractedPage => {
  const document = parsePage(args.html);
  // the head first: defuddle strips the scripts JSON-LD rides in
  const head = readHead(document, args.url);
  const { meta, readable } = extracted(document, args.url);
  return { facts: pageFactsOf(head, meta), readable };
};
