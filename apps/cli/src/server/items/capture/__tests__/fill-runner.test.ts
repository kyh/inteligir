// the fill worker itself, started from source the way a checkout runs it: a job in, its answer
// out, a job past its time answered failed with the worker replaced and the jobs behind it read by
// the fresh one, an idle worker retired, and a stopped runner answering every job failed.

import { setTimeout } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";

import { createFillRunner } from "../fill-runner";
import type { FillRunnerOptions } from "../fill-runner";
import type { FillJobInput } from "../fill-protocol";

const PAGE = `<!doctype html><html lang="en"><head><title>A worker's page</title>
<meta property="og:site_name" content="Worker Site"></head>
<body><article><h1>A worker's page</h1><p>The worker read this paragraph, with no network in reach.</p>
<p>And this one, which is long enough for the extractor to keep as the page's content.</p></article></body></html>`;

const runner = (options: FillRunnerOptions = {}) => {
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

  it("answers a job past its time failed, and reads the jobs behind it on a fresh worker", async () => {
    const WEDGED = "https://site.test/wedged";
    let spawned = 0;
    // the wedged page's budget runs out at once; every other job has a minute
    const made = runner({
      jobTimeoutMs: (job: FillJobInput) => (job.url === WEDGED ? 1 : 60_000),
      onSpawn: () => {
        spawned += 1;
      },
    });
    const [wedged, behind] = await Promise.all([
      made.run({ html: PAGE, kind: "copy-plan", url: WEDGED }),
      made.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/a" }),
    ]);
    expect(wedged).toEqual({ kind: "failed", reason: "the page took too long to read" });
    expect(behind.kind).toBe("copy-plan");
    const after = await made.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/b" });
    expect(after.kind).toBe("copy-plan");
    expect(spawned).toBe(2);
  }, 60_000);

  it("retires a worker left idle and starts a fresh one for the next job", async () => {
    let spawned = 0;
    const made = runner({
      idleRetireMs: 20,
      onSpawn: () => {
        spawned += 1;
      },
    });
    const first = await made.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/a" });
    expect(first.kind).toBe("copy-plan");
    expect(spawned).toBe(1);
    await setTimeout(100);
    const second = await made.run({ html: PAGE, kind: "copy-plan", url: "https://site.test/a" });
    expect(second.kind).toBe("copy-plan");
    expect(spawned).toBe(2);
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
