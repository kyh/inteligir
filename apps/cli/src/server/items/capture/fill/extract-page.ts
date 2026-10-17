// a page's facts and its article: linkedom parses the html, the head is read before defuddle
// strips it, defuddle finds the readable content (with no network: `useAsync` off and a fetch
// that refuses), and the article is written down the body ladder, rich to plain, the first rung
// whose fixpoint keeps at least 97% of its letters winning. The fixpoint is the editor's own, so
// an item opens rich and its first edit is a minimal diff.

import Defuddle from "defuddle";

import { canonicalizeImported } from "@repo/editor/markdown/markdown-doc";

import { resolveWebUrl } from "../css-urls";
import type { PageFacts } from "../fill-protocol";
import { escapeText, htmlToMarkdown } from "./html-to-markdown";
import type { Rung } from "./html-to-markdown";
import { pageFactsOf, readHead } from "./page-meta";
import type { ExtractedMeta } from "./page-meta";
import { parsePage } from "./parse-page";

export const KEPT_MIN = 0.97;
const RUNGS: readonly Rung[] = ["rich", "plain", "text"];

export interface ExtractedPage {
  facts: PageFacts;
  article: string;
  rung: Rung | null;
  kept: number;
}

const refuseFetch: typeof fetch = async () =>
  await Promise.reject(new Error("the fill worker reaches no network"));

// a picture's own address, never an inline placeholder
const isUsableSrc = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "" && !/^data:/iu.test(value.trim());

// links and pictures absolute against the page, lazy pictures given their real source, and
// in-page or script links reduced to their text
const absolutize = (body: HTMLElement, pageUrl: string): void => {
  for (const anchor of body.querySelectorAll("a")) {
    const href = resolveWebUrl(anchor.getAttribute("href") ?? "", pageUrl);
    if (href === null) {
      anchor.removeAttribute("href");
    } else {
      anchor.setAttribute("href", href);
    }
  }
  for (const image of body.querySelectorAll("img")) {
    const raw = [image.getAttribute("src"), image.dataset.src].find(isUsableSrc) ?? "";
    const src = resolveWebUrl(raw, pageUrl);
    if (src === null) {
      image.removeAttribute("src");
    } else {
      image.setAttribute("src", src);
    }
  }
};

interface Laddered {
  markdown: string;
  rung: Rung;
  kept: number;
}

// the first rung whose fixpoint keeps enough of its own letters; past the last, the rung that kept
// the most; null when no rung settles
const ladder = (root: HTMLElement): Laddered | null => {
  let best: Laddered | null = null;
  for (const rung of RUNGS) {
    let markdown: string;
    try {
      markdown = htmlToMarkdown(root, rung);
    } catch {
      // a page nested past turndown's recursion falls to the walk that has none
      continue;
    }
    const imported = canonicalizeImported(markdown);
    if (imported === null) {
      continue;
    }
    if (imported.kept >= KEPT_MIN) {
      return { kept: imported.kept, markdown: imported.markdown, rung };
    }
    if (best === null || imported.kept > best.kept) {
      best = { kept: imported.kept, markdown: imported.markdown, rung };
    }
  }
  return best;
};

const contentRoot = (contentHtml: string, pageUrl: string): HTMLElement => {
  const document = parsePage(
    `<!doctype html><html><head></head><body>${contentHtml}</body></html>`,
  );
  absolutize(document.body, pageUrl);
  return document.body;
};

// a description as the article's one paragraph, for a video or a song whose page holds no prose
const descriptionArticle = (description: string): Laddered | null => {
  const imported = canonicalizeImported(`${escapeText(description)}\n`);
  return imported === null
    ? null
    : { kept: imported.kept, markdown: imported.markdown, rung: "text" };
};

interface Readable extends ExtractedMeta {
  // null: the extractor gave up (a page nested past its recursion); the body is read as text
  content: string | null;
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

// past this nesting the extractor's recursion overflows, after retrying for seconds; no page a
// person reads nests anywhere near it
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

const readableContent = (document: Document, url: string): Readable => {
  if (deeperThan(document.documentElement, EXTRACTOR_DEPTH_MAX)) {
    return { ...NO_META, content: null };
  }
  try {
    const result = new Defuddle(document, { fetch: refuseFetch, url, useAsync: false }).parse();
    return { ...result, content: result.content };
  } catch {
    return { ...NO_META, content: null };
  }
};

export const extractPage = (args: {
  html: string;
  url: string;
  prefer: "article" | "description";
}): ExtractedPage => {
  const document = parsePage(args.html);
  // the head first: defuddle strips the scripts JSON-LD rides in
  const head = readHead(document, args.url);
  const result = readableContent(document, args.url);
  const merged = pageFactsOf(head, result);
  const article =
    (args.prefer === "description" && merged.description !== null
      ? descriptionArticle(merged.description)
      : null) ??
    (result.content === null
      ? ladder(document.body)
      : ladder(contentRoot(result.content, args.url)));
  return {
    article: article?.markdown ?? "",
    facts: merged,
    kept: article?.kept ?? 0,
    rung: article?.rung ?? null,
  };
};
