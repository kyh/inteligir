// the fill worker itself, started from source the way a checkout runs it: a job in, its answer
// out, a job past its time answered failed with the worker replaced, and a stopped runner
// answering every job failed.

import { setTimeout } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";

import { createFillRunner } from "../fill-runner";

const PAGE = `<!doctype html><html lang="en"><head><title>A worker's page</title>
<meta property="og:site_name" content="Worker Site"></head>
<body><article><h1>A worker's page</h1><p>The worker read this paragraph, with no network in reach.</p>
<p>And this one, which is long enough for the extractor to keep as the page's content.</p></article></body></html>`;

const runner = (options: { jobTimeoutMs?: number; idleRetireMs?: number } = {}) => {
  const made = createFillRunner(options);
  onTestFinished(async () => {
    await made.dispose();
  });
  return made;
};

describe("the fill worker", () => {
  it("answers an extract job with the page's facts and its article", async () => {
    const result = await runner().run({
      html: PAGE,
      kind: "extract",
      prefer: "article",
      url: "https://site.test/a",
    });
    expect(result.kind).toBe("extracted");
    if (result.kind !== "extracted") {
      return;
    }
    expect(result.facts.title).toBe("A worker's page");
    expect(result.facts.site).toBe("Worker Site");
    expect(result.article).toContain("The worker read this paragraph, with no network in reach.");
  }, 60_000);

  it("answers a job past its time failed, and the next job on a fresh worker", async () => {
    const made = runner({ jobTimeoutMs: 1 });
    expect(await made.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/a" })).toEqual({
      kind: "failed",
      reason: "the page took too long to read",
    });
    const patient = runner({ idleRetireMs: 20 });
    const first = await patient.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/a" });
    expect(first.kind).toBe("copy-plan");
    // retired while idle, then started again for the next job
    await setTimeout(100);
    const second = await patient.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/a" });
    expect(second.kind).toBe("copy-plan");
  }, 60_000);

  it("answers every job failed once stopped", async () => {
    const made = runner();
    await made.dispose();
    expect(await made.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/a" })).toEqual({
      kind: "failed",
      reason: "the fill worker was stopped",
    });
  });
});
