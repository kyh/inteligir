import { describe, expect, it } from "vitest";

import { FILL_LIMITS } from "@repo/contract/items/link-fill";

import { readHtml } from "./read-html";
import { longPage } from "./test-support/long-page.test-utils";

const MiB = 1024 * 1024;
const HEAP_CAP_MB = 96;

describe("a page at every limit", () => {
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
    expect(process.memoryUsage().heapUsed).toBeLessThan(HEAP_CAP_MB * MiB);
  });
});
