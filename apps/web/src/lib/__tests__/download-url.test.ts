import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { createDownloadUrlReader, downloadHref } from "../download-url";
import type { DownloadUrlDeps } from "../download-url";

type Answer = Response | Error | "hang";

const reader = (respond: () => Answer, deps: Pick<DownloadUrlDeps, "timeoutMs"> = {}) => {
  let calls = 0;
  let nowMs = 1_000_000;
  const read = createDownloadUrlReader({
    ...deps,
    fetch: async (_input, init) => {
      calls += 1;
      const next = respond();
      if (next === "hang") {
        // oxlint-disable-next-line promise/avoid-new -- a GitHub that never answers settles only on the reader's abort, an event
        return await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        });
      }
      return next instanceof Error ? await Promise.reject(next) : await Promise.resolve(next);
    },
    now: () => nowMs,
  });
  return {
    advance: (ms: number) => {
      nowMs += ms;
    },
    calls: () => calls,
    read,
  };
};

// the last answer repeats once the script runs out
const inOrder = (...answers: (() => Answer)[]) => {
  let index = 0;
  return (): Answer => {
    const next = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (next === undefined) {
      throw new Error("inOrder needs at least one answer");
    }
    return next();
  };
};

const DMG_URL = "https://dl.test/x.dmg";
const notFound = () => new Response("{}", { status: 404 });
const release = (assets: unknown[]) => () => Response.json({ assets }, { status: 200 });
const withDmg = release([{ browser_download_url: DMG_URL, name: "Inteligir.dmg" }]);
const status = (code: number) => () => new Response("{}", { status: code });
const unreadable = () => Response.json({ message: "not a release" }, { status: 200 });

describe("the download-url memo", () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("two consecutive reads with no release make one GitHub request", async () => {
    const memo = reader(notFound);
    expect(await memo.read()).toEqual({ kind: "none" });
    expect(await memo.read()).toEqual({ kind: "none" });
    expect(memo.calls()).toBe(1);
  });

  it("caches a found url like any other settled answer", async () => {
    const memo = reader(withDmg);
    expect(await memo.read()).toEqual({ kind: "dmg", url: DMG_URL });
    expect(await memo.read()).toEqual({ kind: "dmg", url: DMG_URL });
    expect(memo.calls()).toBe(1);
  });

  it("answers none for a release that carries no .dmg", async () => {
    const memo = reader(
      release([{ browser_download_url: "https://dl.test/x.zip", name: "x.zip" }]),
    );
    expect(await memo.read()).toEqual({ kind: "none" });
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
    expect(await memo.read()).toEqual({ kind: "unknown" });
    memo.advance(4 * 60 * 1000);
    await memo.read();
    expect(memo.calls()).toBe(1);
    memo.advance(2 * 60 * 1000);
    await memo.read();
    expect(memo.calls()).toBe(2);
  });

  it.each([403, 503])(
    "treats a %i as a read that never settled — only a 404 is an answer about the release",
    async (code) => {
      const memo = reader(status(code));
      expect(await memo.read()).toEqual({ kind: "unknown" });
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ cause: `status ${code}` }));
      memo.advance(4 * 60 * 1000);
      await memo.read();
      expect(memo.calls()).toBe(1);
      memo.advance(2 * 60 * 1000);
      await memo.read();
      expect(memo.calls()).toBe(2);
    },
  );

  it("keeps the last good url when GitHub's quota answers 403", async () => {
    const memo = reader(inOrder(withDmg, status(403)));
    expect(await memo.read()).toEqual({ kind: "dmg", url: DMG_URL });
    memo.advance(61 * 60 * 1000);
    expect(await memo.read()).toEqual({ kind: "dmg", url: DMG_URL });
    expect(memo.calls()).toBe(2);
    memo.advance(4 * 60 * 1000);
    await memo.read();
    expect(memo.calls()).toBe(2);
  });

  it("keeps the last good url through a read that throws or will not parse", async () => {
    const memo = reader(inOrder(withDmg, () => new Error("network down"), unreadable));
    await memo.read();
    memo.advance(61 * 60 * 1000);
    expect(await memo.read()).toEqual({ kind: "dmg", url: DMG_URL });
    memo.advance(6 * 60 * 1000);
    expect(await memo.read()).toEqual({ kind: "dmg", url: DMG_URL });
    expect(memo.calls()).toBe(3);
  });

  it("gives up on a GitHub that never answers", async () => {
    const memo = reader(() => "hang", { timeoutMs: 10 });
    expect(await memo.read()).toEqual({ kind: "unknown" });
  });
});

describe("downloadHref", () => {
  it("links a found .dmg directly", () => {
    expect(downloadHref({ kind: "dmg", url: DMG_URL })).toBe(DMG_URL);
  });

  it("still offers the release page when GitHub has not answered", () => {
    expect(downloadHref({ kind: "unknown" })).toBe(
      "https://github.com/kyh/inteligir/releases/latest",
    );
  });

  it("offers nothing when the release carries no .dmg", () => {
    expect(downloadHref({ kind: "none" })).toBeNull();
  });
});
