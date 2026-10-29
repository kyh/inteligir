import { runInNewContext } from "node:vm";
import { nativeFrameSchema, PAGE_RECEIVER } from "@repo/mobile-editor/bridge-protocol";
import type { FillAnswer, FillJob, NativeFrame } from "@repo/mobile-editor/bridge-protocol";
import { describe, expect, it } from "vitest";
import { createFillPageHost } from "./fill-page-host";

const PAGE_URL =
  "file:///private/var/containers/Bundle/Application/A/Inteligir.app/editor-page/index.html";
const OTHER_URL = "https://example.com/framed.html";

const JOB: FillJob = {
  base64: "PGgxPkZpbGUgb3ZlciBhcHA8L2gxPg==",
  charset: "utf-8",
  prefer: "article",
  url: "https://stephango.com/file-over-app",
};

const READ: FillAnswer = {
  article: "File over app is a philosophy.",
  facts: {
    author: null,
    description: null,
    images: [],
    lang: "en",
    oembed: null,
    published: null,
    site: "Steph Ango",
    title: "File over app",
  },
  kept: 1,
  kind: "read",
  rung: "rich",
};

// the reader WebView, as far as the host reaches it: what each injected script hands the page's
// receiver, and how often it was told to load again
const readerView = () => {
  const frames: NativeFrame[] = [];
  let reloads = 0;
  return {
    frames,
    injectJavaScript: (script: string) => {
      runInNewContext(script, {
        window: {
          [PAGE_RECEIVER]: (text: string) => {
            frames.push(nativeFrameSchema.parse(JSON.parse(text)));
          },
        },
      });
    },
    reload: () => {
      reloads += 1;
    },
    reloads: () => reloads,
  };
};

const hostOver = () => {
  let minted = 0;
  const timers: { run: () => void; cancelled: boolean }[] = [];
  const host = createFillPageHost({
    mintNonce: () => {
      minted += 1;
      return `nonce-${String(minted).padStart(16, "0")}`;
    },
    pageUrl: PAGE_URL,
    setTimer: (_, run) => {
      const timer = { cancelled: false, run };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const view = readerView();
  host.attach(view);
  const ready = (url = PAGE_URL) => {
    host.receive({ data: JSON.stringify({ type: "ready" }), url });
  };
  const answer = (id: number, nonce: string, url = PAGE_URL, answered: FillAnswer = READ) => {
    host.receive({
      data: JSON.stringify({ answer: answered, id, nonce, type: "fillAnswer" }),
      url,
    });
  };
  const fireTimers = () => {
    for (const timer of timers.filter((each) => !each.cancelled)) {
      timer.cancelled = true;
      timer.run();
    }
  };
  return { answer, fireTimers, host, ready, view };
};

describe("the reader page's native end", () => {
  it("starts the page in fill mode under a fresh nonce and sends it the jobs that waited", async () => {
    const { answer, host, ready, view } = hostOver();
    const reading = host.read(JOB);
    expect(view.frames).toStrictEqual([]);

    ready();
    expect(view.frames).toStrictEqual([
      { mode: "fill", nonce: "nonce-0000000000000001", type: "init" },
      { id: 0, job: JOB, nonce: "nonce-0000000000000001", type: "fillJob" },
    ]);

    answer(0, "nonce-0000000000000001");
    await expect(reading).resolves.toStrictEqual(READ);
  });

  it("drops an answer from another document or under another load's nonce", async () => {
    const { answer, host, ready } = hostOver();
    ready();
    let settled = false;
    const reading = host.read(JOB).finally(() => {
      settled = true;
    });

    answer(0, "nonce-0000000000000001", OTHER_URL, { kind: "failed", reason: "forged" });
    answer(0, "nonce-9999999999999999", PAGE_URL, { kind: "failed", reason: "stale" });
    await Promise.resolve();
    expect(settled).toBe(false);

    answer(0, "nonce-0000000000000001");
    await expect(reading).resolves.toStrictEqual(READ);
  });

  it("fails a job the page never answers and loads the page again for the next", async () => {
    const { fireTimers, host, ready, view } = hostOver();
    ready();
    const reading = host.read(JOB);

    fireTimers();
    await expect(reading).rejects.toThrow("the reader did not answer within 30000ms");
    expect(view.reloads()).toBe(1);

    const next = host.read(JOB);
    ready();
    expect(view.frames.at(-2)).toStrictEqual({
      mode: "fill",
      nonce: "nonce-0000000000000002",
      type: "init",
    });
    expect(view.frames.at(-1)).toMatchObject({ id: 1, nonce: "nonce-0000000000000002" });
    void next.catch(() => null);
  });

  it("fails every job the page held when it goes away", async () => {
    const { host, ready, view } = hostOver();
    ready();
    const first = host.read(JOB);
    const second = host.read(JOB);

    host.reload();
    await expect(first).rejects.toThrow("the reader page went away before it answered");
    await expect(second).rejects.toThrow("the reader page went away before it answered");
    expect(view.reloads()).toBe(1);

    const third = host.read(JOB);
    host.attach(null);
    await expect(third).rejects.toThrow("the reader page went away before it answered");
  });
});
