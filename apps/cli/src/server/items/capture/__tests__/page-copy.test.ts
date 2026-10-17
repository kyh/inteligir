// what a page copy asks the network for: a page names as many stylesheets and pictures as it
// likes, so the copy asks for a bounded few, and once its time is up it asks for nothing more.

import { describe, expect, it } from "vitest";

import { inlineFillRunner } from "../fill-runner";
import type { FillJobInput, FillResult } from "../fill-protocol";
import type { FetchResult, GuardedFetch } from "../guarded-fetch";
import { keepPageCopy } from "../page-copy";

const PAGE = "https://site.test/article";

const NOT_FOUND: FetchResult = {
  failure: { kind: "status", reason: "not found", status: 404, transient: false },
  ok: false,
};

const planOf =
  (plan: { stylesheets?: string[]; images?: string[] }) =>
  (job: FillJobInput): FillResult => {
    if (job.kind === "copy-plan") {
      return {
        images: plan.images ?? [],
        kind: "copy-plan",
        styleImports: [],
        styleRefs: [],
        stylesheets: plan.stylesheets ?? [],
      };
    }
    return job.kind === "copy-build"
      ? { html: "<!DOCTYPE html>\n<p>copy</p>\n", kind: "copy" }
      : { kind: "failed", reason: "not asked" };
  };

const recording = (onFetch: (count: number) => void = () => {}) => {
  const asked: string[] = [];
  const fetcher: GuardedFetch = {
    fetch: async (request) => {
      asked.push(request.url);
      onFetch(asked.length);
      return await Promise.resolve(NOT_FOUND);
    },
    reachOf: async () => await Promise.resolve({ ok: true, reach: "public" }),
  };
  return { asked, fetcher };
};

const core = {
  writeContentAddressed: async () =>
    await Promise.resolve({ path: "assets/pages/abc.html", wrote: true }),
};

const many = (count: number, make: (index: number) => string): string[] =>
  Array.from({ length: count }, (_, index) => make(index));

describe("a page copy", () => {
  it("asks for at most 64 stylesheets and 400 pictures, however many the page names", async () => {
    const { asked, fetcher } = recording();
    const copy = await keepPageCopy(
      {
        core,
        fetcher,
        runner: inlineFillRunner(
          planOf({
            images: many(2000, (index) => `https://img.test/${index}.png`),
            stylesheets: many(2000, (index) => `https://s${index}.slow.test/a.css`),
          }),
        ),
      },
      {
        html: "<p>page</p>",
        reach: "public",
        savedOn: "today",
        signal: new AbortController().signal,
        url: PAGE,
      },
    );
    expect(copy).toEqual({ kind: "copy", path: "assets/pages/abc.html", wrote: true });
    expect(asked.filter((url) => url.endsWith(".css"))).toHaveLength(64);
    expect(asked.filter((url) => url.endsWith(".png"))).toHaveLength(400);
  });

  it("asks for nothing more once the copy is stopped", async () => {
    const controller = new AbortController();
    const { asked, fetcher } = recording((count) => {
      if (count === 4) {
        controller.abort();
      }
    });
    const copy = await keepPageCopy(
      {
        core,
        fetcher,
        runner: inlineFillRunner(
          planOf({
            images: many(50, (index) => `https://img.test/${index}.png`),
            stylesheets: many(50, (index) => `https://s${index}.slow.test/a.css`),
          }),
        ),
      },
      {
        html: "<p>page</p>",
        reach: "public",
        savedOn: "today",
        signal: controller.signal,
        url: PAGE,
      },
    );
    expect(copy).toEqual({ kind: "failed" });
    expect(asked).toHaveLength(4);
  });
});
