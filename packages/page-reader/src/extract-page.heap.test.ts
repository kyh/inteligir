// The reading of the largest page any filler takes, inside a 96 MB heap, every module and the test
// runner's own included: this project's process runs with its heap capped (`vitest.config.ts`), so
// a reading that outgrows it takes the process down and fails the run. Neither host is that tight:
// a Vercel function holds 2 GB, shared by every fill its instance runs at once, and the extension's
// worker a browser's heap, so the cap is a budget that leaves both room. The page is the whole 5 MiB
// the fillers read as a page, its readable part twice the article's budget.

import { describe, expect, it } from "vitest";

import { FILL_LIMITS } from "@repo/contract/items/link-fill";

import { readHtml } from "./read-html";
import { longPage } from "./test-support/long-page";

const MiB = 1024 * 1024;
// the old generation this project's process is capped at (`vitest.config.ts`)
const HEAP_CAP_MB = 96;

describe("a page at every limit", () => {
  // a second of work at the budget, which a loaded machine stretches past the default timeout
  it("reads within its heap budget", { timeout: 30_000 }, () => {
    const article = FILL_LIMITS.articleBytes * 2;
    const page = longPage(article, FILL_LIMITS.htmlBytes - article);
    expect(page.html.length).toBeGreaterThanOrEqual(FILL_LIMITS.htmlBytes);
    let n = 0;
    const read = readHtml(
      { html: page.html, prefer: "article", url: "https://pages.example/long" },
      () => `b${String((n += 1))}`,
    );
    expect(read.article.blocks.length).toBeGreaterThan(500);
    expect(read.rung).toBe("rich");
    // what stays live once read: the page, its blocks, every module the runner holds (78 MB, measured)
    expect(process.memoryUsage().heapUsed).toBeLessThan(HEAP_CAP_MB * MiB);
  });
});
