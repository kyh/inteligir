import { ORPCError } from "@orpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { CapturedPage } from "../capture/captured-page";
import { CAPTURE_DEADLINE_MS } from "./capture-tab";
import { readConnection } from "./connection";
import type { Connection } from "./connection";
import { saveAddress, savePicture, saveTab } from "./save-page";
import type { SaveDeps } from "./save-page";
import { queuedSaves, SEND_ALARM } from "./save-queue";
import { CONNECTION, fakeCloud, handOver, MINTED, NEXT, savedAs } from "./test-support/fake-cloud";
import type { FakeCloud } from "./test-support/fake-cloud";

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

const URL_SAVED = "https://example.test/essays/file-over-app";
const PASSAGE = "Apps are ephemeral, and the files they write outlast every one of them.";

const ARTICLE_HTML = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  "<title>File over app</title>",
  '<meta property="og:image" content="https://cdn.example.test/cover.png">',
  '<meta property="og:image" content="http://192.168.1.4/router.png">',
  '<meta name="author" content="Steph Ango">',
  "</head><body><article>",
  "<h1>File over app</h1>",
  "<p>If you want to create digital artifacts that last, they must be files you can control.</p>",
  `<p>${PASSAGE}</p>`,
  "<p>The file is the one thing every app agrees on, so it is the thing to keep.</p>",
  "</article></body></html>",
].join("\n");

// a PNG's signature and IHDR, of a cover's size
const PNG = (() => {
  const head = new Uint8Array(24);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(head.buffer);
  view.setUint32(16, 1200);
  view.setUint32(20, 630);
  return head;
})();

const TAB = { id: 7, title: "File over app — Steph Ango", url: URL_SAVED };

const page = (overrides: Partial<CapturedPage> = {}): CapturedPage => ({
  html: ARTICLE_HTML,
  selection: PASSAGE,
  title: "File over app",
  url: URL_SAVED,
  ...overrides,
});

let seq = 0;

const depsWith = (
  cloud: FakeCloud,
  options: { captured?: CapturedPage | null; connection?: Connection | null } = {},
) => {
  const covers: string[] = [];
  const deps: SaveDeps = {
    capture: async () => (options.captured === undefined ? page() : options.captured),
    cloud: () => cloud.cloud,
    connection: async () => (options.connection === undefined ? CONNECTION : options.connection),
    fetchCover: async (url) => {
      covers.push(url);
      return PNG;
    },
    newBlockId: () => {
      seq += 1;
      return `block-${String(seq)}`;
    },
    now: () => Date.UTC(2026, 10, 5, 12),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  };
  return { covers, deps };
};

describe("a tab saved", () => {
  it("is read here and saved read: its article, its facts, its cover and the passage selected", async () => {
    const cloud = fakeCloud({});
    const run = depsWith(cloud);
    await expect(saveTab(run.deps, { tab: TAB })).resolves.toStrictEqual({
      created: true,
      kind: "saved",
      title: "File over app",
    });
    const [save] = cloud.saves;
    expect(save).toMatchObject({
      coverSha: "c".repeat(64),
      facts: { author: "Steph Ango" },
      folderId: null,
      selection: PASSAGE,
      tags: [],
      title: "File over app",
      url: URL_SAVED,
    });
    expect(JSON.stringify(save?.article)).toContain(PASSAGE);
    expect(cloud.uploads).toStrictEqual([{ bytes: PNG, mime: "image/png" }]);
    // a public page never sends this browser into the person's own network
    expect(run.covers).toStrictEqual(["https://cdn.example.test/cover.png"]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("says a page the library holds is already in it", async () => {
    const cloud = fakeCloud({ save: async () => savedAs("File over app", true) });
    await expect(saveTab(depsWith(cloud).deps, { tab: TAB })).resolves.toMatchObject({
      created: false,
    });
  });

  it("is saved as its link, with the browser's own reading of the selection, when it cannot be scripted", async () => {
    const cloud = fakeCloud({});
    const run = depsWith(cloud, { captured: null });
    await saveTab(run.deps, { selectionText: `  ${PASSAGE} `, tab: TAB });
    expect(cloud.saves).toStrictEqual([]);
    expect(cloud.links).toStrictEqual([
      expect.objectContaining({ selection: PASSAGE, title: TAB.title, url: URL_SAVED }),
    ]);
  });

  it("is saved as its link once a tab that never answers its capture is past the deadline", async () => {
    vi.useFakeTimers();
    const cloud = fakeCloud({});
    const run = depsWith(cloud);
    const stalled = {
      ...run.deps,
      // oxlint-disable-next-line promise/avoid-new -- a capture that never settles, as a page stuck loading answers
      capture: async () => await new Promise<CapturedPage | null>(() => {}),
    };
    const saved = saveTab(stalled, { tab: TAB });
    await vi.advanceTimersByTimeAsync(CAPTURE_DEADLINE_MS);
    await expect(saved).resolves.toMatchObject({ kind: "saved" });
    expect(cloud.saves).toStrictEqual([]);
    expect(cloud.links).toStrictEqual([
      expect.objectContaining({ title: TAB.title, url: URL_SAVED }),
    ]);
  });

  it("is saved as its link, for the cloud to read, when its page is past the capture's cap", async () => {
    const cloud = fakeCloud({});
    await saveTab(depsWith(cloud, { captured: page({ html: null }) }).deps, { tab: TAB });
    expect(cloud.links).toStrictEqual([
      expect.objectContaining({ selection: PASSAGE, url: URL_SAVED }),
    ]);
  });

  it("waits, as its address, title and passage alone, when the cloud does not answer", async () => {
    const cloud = fakeCloud({
      save: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(saveTab(depsWith(cloud).deps, { tab: TAB })).resolves.toStrictEqual({
      kind: "queued",
    });
    const [queued] = await queuedSaves();
    expect(queued).toMatchObject({
      deviceId: CONNECTION.deviceId,
      selection: PASSAGE,
      title: "File over app",
      url: URL_SAVED,
    });
    expect(Object.keys(queued ?? {}).toSorted()).toStrictEqual([
      "deviceId",
      "id",
      "opId",
      "savedAt",
      "selection",
      "title",
      "url",
      "waitingSince",
    ]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
  });

  it("is kept in the queue before its first call goes", async () => {
    let queuedAtCall: number | null = null;
    const cloud = fakeCloud({
      save: async () => {
        const queued = await queuedSaves();
        queuedAtCall = queued.length;
        return savedAs("File over app");
      },
    });
    await saveTab(depsWith(cloud).deps, { tab: TAB });
    expect(queuedAtCall).toBe(1);
  });

  it("ends the connection, and asks for it again, once the cloud says the credential is gone", async () => {
    await handOver(MINTED);
    const cloud = fakeCloud({
      save: async () => {
        throw new ORPCError("UNAUTHORIZED");
      },
    });
    await expect(saveTab(depsWith(cloud).deps, { tab: TAB })).resolves.toStrictEqual({
      kind: "refused",
      reason: "signed-out",
    });
    await expect(readConnection()).resolves.toBeNull();
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("keeps the connection a connect handed over while its call under the old one was on its way", async () => {
    await handOver(MINTED);
    const cloud = fakeCloud({
      save: async () => {
        await handOver(NEXT);
        throw new ORPCError("UNAUTHORIZED");
      },
    });
    await expect(saveTab(depsWith(cloud).deps, { tab: TAB })).resolves.toStrictEqual({
      kind: "refused",
      reason: "failed",
    });
    await expect(readConnection()).resolves.toMatchObject({ deviceId: NEXT.deviceId });
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("asks for a connection first, and saves nothing off the web", async () => {
    const cloud = fakeCloud({});
    await expect(
      saveTab(depsWith(cloud, { connection: null }).deps, { tab: TAB }),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason: "not-connected",
    });
    await expect(
      saveTab(depsWith(cloud).deps, { tab: { ...TAB, url: "chrome://settings" } }),
    ).resolves.toStrictEqual({ kind: "refused", reason: "unsupported-page" });
    expect(cloud.saves).toStrictEqual([]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });
});

describe("a right-click's address or picture", () => {
  it("saves a link or a web picture by its address, for the cloud to read", async () => {
    const cloud = fakeCloud({});
    await saveAddress(depsWith(cloud).deps, "https://example.test/a-picture.png");
    expect(cloud.links).toStrictEqual([
      expect.objectContaining({ url: "https://example.test/a-picture.png" }),
    ]);
  });

  it("saves a picture a page drew from its bytes as a file, named after the page", async () => {
    const cloud = fakeCloud({});
    await expect(
      savePicture(depsWith(cloud).deps, { bytes: PNG, pageUrl: URL_SAVED }),
    ).resolves.toMatchObject({
      created: true,
      kind: "saved",
    });
    expect(cloud.uploads).toStrictEqual([{ bytes: PNG, mime: "image/png" }]);
    expect(cloud.files).toStrictEqual([
      expect.objectContaining({ name: "file-over-app.png", sha: "c".repeat(64) }),
    ]);
  });

  it("keeps the connection a connect handed over while a picture's call was on its way", async () => {
    await handOver(MINTED);
    const cloud = fakeCloud({
      putFile: async () => {
        await handOver(NEXT);
        throw new ORPCError("UNAUTHORIZED");
      },
    });
    await expect(
      savePicture(depsWith(cloud).deps, { bytes: PNG, pageUrl: URL_SAVED }),
    ).resolves.toStrictEqual({ kind: "refused", reason: "failed" });
    await expect(readConnection()).resolves.toMatchObject({ deviceId: NEXT.deviceId });
  });

  it("says a picture's bytes need a connection, since they wait in no queue", async () => {
    const cloud = fakeCloud({
      putFile: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(
      savePicture(depsWith(cloud).deps, { bytes: PNG, pageUrl: URL_SAVED }),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason: "needs-connection",
    });
    await expect(
      savePicture(depsWith(fakeCloud({})).deps, {
        bytes: new TextEncoder().encode("not a picture"),
        pageUrl: URL_SAVED,
      }),
    ).resolves.toStrictEqual({ kind: "refused", reason: "unsupported-page" });
  });
});
