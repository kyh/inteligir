import type { ExtractedPageBlocks, PageArgs } from "./page-facts";

export type ReadHtml = (args: PageArgs, newBlockId: () => string) => ExtractedPageBlocks;

/** @public */
export declare const readHtml: ReadHtml;
