import { runInNewContext } from "node:vm";
import { nativeFrameSchema, PAGE_RECEIVER } from "@repo/editor-bridge/protocol";
import type { MergeAnswer, NativeFrame } from "@repo/editor-bridge/protocol";
import { describe, expect, it } from "vitest";
import { createHeadlessPageHost } from "./headless-page-host";

const PAGE_URL =
  "file:///private/var/containers/Bundle/Application/A/Inteligir.app/editor-page/index.html";
const OTHER_URL = "https://example.com/framed.html";

const paragraph = (text: string) => ({ children: [{ text }], id: "p1", type: "p" as const });

const SIDES = { base: paragraph("a"), mine: paragraph("a, mine"), theirs: paragraph("a") };
const MERGED = { block: paragraph("a, mine"), overlapped: false };

// the headless WebView, as far as the host reaches it: what each injected script hands the page's
// receiver, and how often it was told to load again
const headlessView = () => {
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
  const host = createHeadlessPageHost({
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
  const view = headlessView();
  host.attach(view);
  const ready = (url = PAGE_URL) => {
    host.receive({ data: JSON.stringify({ type: "ready" }), url });
  };
  const answer = (id: number, nonce: string, url = PAGE_URL, merged: MergeAnswer = MERGED) => {
    host.receive({ data: JSON.stringify({ id, merged, nonce, type: "mergeAnswer" }), url });
  };
  const fireTimers = () => {
    for (const timer of timers.filter((each) => !each.cancelled)) {
      timer.cancelled = true;
      timer.run();
    }
  };
  return { answer, fireTimers, host, ready, view };
};

describe("the headless page's native end", () => {
  it("starts the page headless under a fresh nonce and sends it the jobs that waited", async () => {
    const { answer, host, ready, view } = hostOver();
    const merging = host.merge(SIDES);
    expect(view.frames).toStrictEqual([]);

    ready();
    expect(view.frames).toStrictEqual([
      { mode: "headless", nonce: "nonce-0000000000000001", type: "init" },
      { id: 0, nonce: "nonce-0000000000000001", sides: SIDES, type: "mergeJob" },
    ]);

    answer(0, "nonce-0000000000000001");
    await expect(merging).resolves.toStrictEqual(MERGED);
  });

  it("drops an answer from another document or under another load's nonce", async () => {
    const { answer, host, ready } = hostOver();
    ready();
    let settled = false;
    const merging = host.merge(SIDES).finally(() => {
      settled = true;
    });

    answer(0, "nonce-0000000000000001", OTHER_URL, null);
    answer(0, "nonce-9999999999999999", PAGE_URL, null);
    await Promise.resolve();
    expect(settled).toBe(false);

    answer(0, "nonce-0000000000000001");
    await expect(merging).resolves.toStrictEqual(MERGED);
  });

  it("fails a job the page never answers and loads the page again for the next", async () => {
    const { fireTimers, host, ready, view } = hostOver();
    ready();
    const merging = host.merge(SIDES);

    fireTimers();
    await expect(merging).rejects.toThrow("the headless page did not answer within 30000ms");
    expect(view.reloads()).toBe(1);

    const next = host.merge(SIDES);
    ready();
    expect(view.frames.at(-2)).toStrictEqual({
      mode: "headless",
      nonce: "nonce-0000000000000002",
      type: "init",
    });
    expect(view.frames.at(-1)).toMatchObject({ id: 1, nonce: "nonce-0000000000000002" });
    void next.catch(() => null);
  });

  it("fails every job the page held when it goes away", async () => {
    const { host, ready, view } = hostOver();
    ready();
    const first = host.merge(SIDES);
    const second = host.merge(SIDES);

    host.reload();
    await expect(first).rejects.toThrow("the headless page went away before it answered");
    await expect(second).rejects.toThrow("the headless page went away before it answered");
    expect(view.reloads()).toBe(1);

    const third = host.merge(SIDES);
    host.attach(null);
    await expect(third).rejects.toThrow("the headless page went away before it answered");
  });

  it("hands a block two devices changed to the page's merge, and fails one it could not merge", async () => {
    const { answer, host, ready, view } = hostOver();
    ready();
    const merging = host.merge(SIDES);
    const failing = host.merge(SIDES);
    expect(view.frames.slice(-2)).toStrictEqual([
      { id: 0, nonce: "nonce-0000000000000001", sides: SIDES, type: "mergeJob" },
      { id: 1, nonce: "nonce-0000000000000001", sides: SIDES, type: "mergeJob" },
    ]);
    answer(0, "nonce-0000000000000001");
    answer(1, "nonce-0000000000000001", PAGE_URL, null);
    await expect(merging).resolves.toStrictEqual(MERGED);
    await expect(failing).rejects.toThrow("could not merge");
  });
});
