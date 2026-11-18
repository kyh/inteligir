import type { ArticleBlocks } from "@repo/editor/headless/codec/item-markdown";

export interface PageArgs {
  readonly html: string;
  readonly url: string;
  readonly prefer: "article" | "description";
}

export interface PageFacts {
  readonly author: string | null;
  readonly description: string | null;
  readonly images: readonly string[];
  readonly lang: string | null;
  readonly oembed: string | null;
  readonly published: string | null;
  readonly site: string | null;
  readonly title: string | null;
}

export type Rung = "rich" | "text";

export interface ExtractedPageBlocks {
  readonly facts: PageFacts;
  readonly article: ArticleBlocks;
  readonly rung: Rung | null;
}
