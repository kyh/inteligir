// what a page says about itself, as a wire carries it, and what the reader made of its text: the
// phone's page answers the phone with the facts. zod alone, so a host that only carries the answer
// loads no DOM and no extractor.

import { z } from "zod";

// a page to read: its html, the address it was read at, and which text it is kept for, its prose or
// (a video's, a song's) its description
export interface PageArgs {
  readonly html: string;
  readonly url: string;
  readonly prefer: "article" | "description";
}

export const pageFactsSchema = z.strictObject({
  author: z.string().nullable(),
  description: z.string().nullable(),
  // cover candidates, the page's own order of preference, absolute web urls
  images: z.array(z.string()),
  lang: z.string().nullable(),
  // the page's own oEmbed discovery link
  oembed: z.string().nullable(),
  published: z.string().nullable(),
  site: z.string().nullable(),
  title: z.string().nullable(),
});
export type PageFacts = z.infer<typeof pageFactsSchema>;

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
