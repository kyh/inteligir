// what a page says about itself and what the reader made of its text, as a wire carries them: the
// Mac's fill worker answers its server thread with it, and the phone's page answers the phone. zod
// alone, so a host that only carries the answer loads no DOM and no extractor.

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
export const rungSchema = z.enum(["rich", "plain", "text"]);
export type Rung = z.infer<typeof rungSchema>;

export const extractedPageSchema = z.strictObject({
  // the article as the editor's own fixpoint; "" when the page holds no text the editor could keep
  article: z.string(),
  facts: pageFactsSchema,
  // the share of the converted letters the fixpoint kept
  kept: z.number(),
  rung: rungSchema.nullable(),
});
export type ExtractedPage = z.infer<typeof extractedPageSchema>;
