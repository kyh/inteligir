// The reading of the largest page any filler takes, inside a heap the size of a Worker isolate's
// (https://developers.cloudflare.com/workers/platform/limits/, 128 MB, every module and the test
// runner's own included): this project's process runs with its heap capped (`vitest.config.ts`),
// so a reading that outgrows it takes the process down and fails the run. The page is the whole
// 5 MiB the fillers read as a page, its readable part twice the article's budget.

import { describe, expect, it } from "vitest";

import { FILL_LIMITS } from "@repo/notes/items/link-fill";

import { extractPageBlocks } from "./extract-page";
import { parsePage } from "./linkedom-page";
import { longPage } from "./test-support/long-page";

const MiB = 1024 * 1024;
// the old generation this project's process is capped at (`vitest.config.ts`)
const HEAP_CAP_MB = 96;

describe("a page at every limit", () => {
  // the reading is seconds of work at the budget, which the default timeout does not cover
  it("reads within a Worker isolate's heap", { timeout: 120_000 }, () => {
    const article = FILL_LIMITS.articleBytes * 2;
    const page = longPage(article, FILL_LIMITS.htmlBytes - article);
    expect(page.html.length).toBeGreaterThanOrEqual(FILL_LIMITS.htmlBytes);
    let n = 0;
    const read = extractPageBlocks(
      { html: page.html, prefer: "article", url: "https://pages.example/long" },
      parsePage,
      () => `b${String((n += 1))}`,
    );
    expect(read.article.blocks.length).toBeGreaterThan(500);
    expect(read.rung).toBe("rich");
    // what stays live once read: the page, its blocks, every module the runner holds (85 MB, measured)
    expect(process.memoryUsage().heapUsed).toBeLessThan(HEAP_CAP_MB * MiB);
  });
});
