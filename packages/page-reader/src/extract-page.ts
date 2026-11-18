import Defuddle from "defuddle";

import { parsePage } from "./linkedom-page";
import type { PageArgs, PageFacts } from "./page-facts";
import { pageFactsOf, readHead } from "./page-meta";
import type { ExtractedMeta } from "./page-meta";

const refuseFetch: typeof fetch = async () =>
  await Promise.reject(new Error("the page reader reaches no network"));

type Readable =
  | { readonly kind: "content"; readonly html: string }
  | { readonly kind: "body"; readonly body: HTMLElement };

interface ExtractedPage {
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

const EXTRACTOR_DEPTH_MAX = 256;

const deeperThan = (root: Element, limit: number) => {
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

const extracted = (document: Document, url: string) => {
  const gaveUp: Extracted = { meta: NO_META, readable: { body: document.body, kind: "body" } };

  if (deeperThan(document.documentElement, EXTRACTOR_DEPTH_MAX)) {
    return gaveUp;
  }

  try {
    const result = new Defuddle(document, { fetch: refuseFetch, url, useAsync: false }).parse();

    return {
      meta: result,
      readable: { html: result.content, kind: "content" },
    } satisfies Extracted;
  } catch {
    return gaveUp;
  }
};

export const extractPage = (args: PageArgs) => {
  const document = parsePage(args.html);
  const head = readHead(document, args.url);
  const { meta, readable } = extracted(document, args.url);

  return { facts: pageFactsOf(head, meta), readable } satisfies ExtractedPage;
};
