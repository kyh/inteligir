// what a page says about itself and what the reader made of its text, in types that name no DOM and
// no extractor, so a program typed without a DOM (the cloud's Worker,
// apps/web/src/worker/tsconfig.json) can name what `read-html.ts` answers.

import type { ArticleBlocks } from "@repo/editor/codec/item-markdown";

// a page to read: its html, the address it was read at, and which text it is kept for, its prose or
// (a video's, a song's) its description
export interface PageArgs {
  readonly html: string;
  readonly url: string;
  readonly prefer: "article" | "description";
}

export interface PageFacts {
  readonly author: string | null;
  readonly description: string | null;
  // cover candidates, the page's own order of preference, absolute web urls
  readonly images: readonly string[];
  readonly lang: string | null;
  // the page's own oEmbed discovery link
  readonly oembed: string | null;
  readonly published: string | null;
  readonly site: string | null;
  readonly title: string | null;
}

// how an article was read: as the page's tree, or as its words alone
export type Rung = "rich" | "text";

// a page read: its facts and its article as the library's blocks
export interface ExtractedPageBlocks {
  readonly facts: PageFacts;
  // the article as its item's article section; no blocks when the page holds no text
  readonly article: ArticleBlocks;
  // null when the editor refused every reading of the page's text
  readonly rung: Rung | null;
}
