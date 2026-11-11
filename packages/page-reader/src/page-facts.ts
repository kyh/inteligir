// what a page says about itself and what the reader made of its text, in types that name no DOM and
// no extractor.

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

// the body ladder's rungs, rich to plain
export type Rung = "rich" | "plain" | "text";

export interface ExtractedPage {
  // the article as the editor's own fixpoint; "" when the page holds no text the editor could keep
  readonly article: string;
  readonly facts: PageFacts;
  // the share of the converted letters the fixpoint kept
  readonly kept: number;
  readonly rung: Rung | null;
}
