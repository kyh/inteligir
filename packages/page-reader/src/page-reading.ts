// The reading as the library's blocks, in types that name no DOM, so a program typed without one
// (the cloud's Worker, apps/web/src/worker/tsconfig.json) can name what `read-html.ts` answers.
// Apart from `page-facts.ts`, whose answer a host carries without the editor's codec.

import type { ArticleBlocks } from "@repo/editor/codec/item-markdown";

import type { PageFacts, Rung } from "./page-facts";

export interface ExtractedPageBlocks {
  readonly facts: PageFacts;
  // the article as its item's article section; no blocks when the page holds no text the editor
  // could keep
  readonly article: ArticleBlocks;
  readonly kept: number;
  readonly rung: Rung | null;
}
