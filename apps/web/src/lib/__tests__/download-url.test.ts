// The CTA's memo caches every SETTLED outcome, not only the happy path: a
// repo with no release answers 404 on every read, and an uncached miss turns
// GitHub's 60/hour unauthenticated quota into an hour of 403s.

import { describe, expect, it } from "vitest";
import { createDownloadUrlReader } from "../download-url";

function reader(answer: () => Response | Error) {
  let calls = 0;
  let nowMs = 1_000_000;
  const read = createDownloadUrlReader({
    fetch: () => {
      calls += 1;
      const next = answer();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    now: () => nowMs,
  });
  return {
    read,
    calls: () => calls,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

const notFound = () => new Response("{}", { status: 404 });
const release = (assets: unknown[]) => new Response(JSON.stringify({ assets }), { status: 200 });

describe("the download-url memo", () => {
  it("two consecutive reads with no release make one GitHub request", async () => {
    const memo = reader(notFound);
    expect(await memo.read()).toBeNull();
    expect(await memo.read()).toBeNull();
    expect(memo.calls()).toBe(1);
  });

  it("caches a found url like any other settled answer", async () => {
    const memo = reader(() =>
      release([{ name: "Inteligir.dmg", browser_download_url: "https://dl.test/x.dmg" }]),
    );
    expect(await memo.read()).toBe("https://dl.test/x.dmg");
    expect(await memo.read()).toBe("https://dl.test/x.dmg");
    expect(memo.calls()).toBe(1);
  });

  it("holds a settled miss for the full window", async () => {
    const memo = reader(notFound);
    await memo.read();
    memo.advance(59 * 60 * 1000);
    await memo.read();
    expect(memo.calls()).toBe(1);
    memo.advance(2 * 60 * 1000);
    await memo.read();
    expect(memo.calls()).toBe(2);
  });

  it("retries a read that never settled sooner than a settled one", async () => {
    const memo = reader(() => new Error("network down"));
    expect(await memo.read()).toBeNull();
    memo.advance(4 * 60 * 1000);
    await memo.read();
    expect(memo.calls()).toBe(1);
    memo.advance(2 * 60 * 1000);
    await memo.read();
    expect(memo.calls()).toBe(2);
  });
});
