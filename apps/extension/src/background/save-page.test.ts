import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { CapturedPage } from "../capture/captured-page";
import type { Connection } from "./connection";
import { saveAddress, savePicture, saveTab } from "./save-page";
import type { SaveDeps } from "./save-page";
import { queuedSaves, SEND_ALARM } from "./save-queue";
import { CONNECTION, fakeCloud, savedAs } from "./test-support/fake-cloud";
import type { FakeCloud } from "./test-support/fake-cloud";

beforeEach(() => {
  fakeBrowser.reset();
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
  let signedOut = 0;
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
    signedOut: async () => {
      signedOut += 1;
    },
  };
  return { covers, deps, signedOut: () => signedOut };
};

describe("a tab saved", () => {
  it("is read here and saved read: its article, its facts, its cover and the passage selected", async () => {
    const cloud = fakeCloud({});
    const run = depsWith(cloud);
    expect(await saveTab(run.deps, { tab: TAB })).toEqual({
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
    expect(cloud.uploads).toEqual([{ bytes: PNG, mime: "image/png" }]);
    // a public page never sends this browser into the person's own network
    expect(run.covers).toEqual(["https://cdn.example.test/cover.png"]);
    expect(await queuedSaves()).toEqual([]);
  });

  it("says a page the library holds is already in it", async () => {
    const cloud = fakeCloud({ save: async () => savedAs("File over app", true) });
    expect(await saveTab(depsWith(cloud).deps, { tab: TAB })).toMatchObject({ created: false });
  });

  it("is saved as its link, with the browser's own reading of the selection, when it cannot be scripted", async () => {
    const cloud = fakeCloud({});
    const run = depsWith(cloud, { captured: null });
    await saveTab(run.deps, { selectionText: `  ${PASSAGE} `, tab: TAB });
    expect(cloud.saves).toEqual([]);
    expect(cloud.links).toEqual([
      expect.objectContaining({ selection: PASSAGE, title: TAB.title, url: URL_SAVED }),
    ]);
  });

  it("is saved as its link, for the cloud to read, when its page is past the capture's cap", async () => {
    const cloud = fakeCloud({});
    await saveTab(depsWith(cloud, { captured: page({ html: null }) }).deps, { tab: TAB });
    expect(cloud.links).toEqual([expect.objectContaining({ selection: PASSAGE, url: URL_SAVED })]);
  });

  it("waits, as its address, title and passage alone, when the cloud does not answer", async () => {
    const cloud = fakeCloud({
      save: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await saveTab(depsWith(cloud).deps, { tab: TAB })).toEqual({ kind: "queued" });
    const [queued] = await queuedSaves();
    expect(queued).toMatchObject({
      deviceId: CONNECTION.deviceId,
      selection: PASSAGE,
      title: "File over app",
      url: URL_SAVED,
    });
    expect(Object.keys(queued ?? {}).toSorted()).toEqual([
      "deviceId",
      "id",
      "opId",
      "savedAt",
      "selection",
      "title",
      "url",
      "waitingSince",
    ]);
    expect(await browser.alarms.get(SEND_ALARM)).toBeDefined();
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

  it("asks for a connection first, and saves nothing off the web", async () => {
    const cloud = fakeCloud({});
    expect(await saveTab(depsWith(cloud, { connection: null }).deps, { tab: TAB })).toEqual({
      kind: "refused",
      reason: "not-connected",
    });
    expect(
      await saveTab(depsWith(cloud).deps, { tab: { ...TAB, url: "chrome://settings" } }),
    ).toEqual({ kind: "refused", reason: "unsupported-page" });
    expect(cloud.saves).toEqual([]);
    expect(await queuedSaves()).toEqual([]);
  });
});

describe("a right-click's address or picture", () => {
  it("saves a link or a web picture by its address, for the cloud to read", async () => {
    const cloud = fakeCloud({});
    await saveAddress(depsWith(cloud).deps, "https://example.test/a-picture.png");
    expect(cloud.links).toEqual([
      expect.objectContaining({ url: "https://example.test/a-picture.png" }),
    ]);
  });

  it("saves a picture a page drew from its bytes as a file, named after the page", async () => {
    const cloud = fakeCloud({});
    expect(
      await savePicture(depsWith(cloud).deps, { bytes: PNG, pageUrl: URL_SAVED }),
    ).toMatchObject({
      created: true,
      kind: "saved",
    });
    expect(cloud.uploads).toEqual([{ bytes: PNG, mime: "image/png" }]);
    expect(cloud.files).toEqual([
      expect.objectContaining({ name: "file-over-app.png", sha: "c".repeat(64) }),
    ]);
  });

  it("says a picture's bytes need a connection, since they wait in no queue", async () => {
    const cloud = fakeCloud({
      putFile: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await savePicture(depsWith(cloud).deps, { bytes: PNG, pageUrl: URL_SAVED })).toEqual({
      kind: "refused",
      reason: "needs-connection",
    });
    expect(
      await savePicture(depsWith(fakeCloud({})).deps, {
        bytes: new TextEncoder().encode("not a picture"),
        pageUrl: URL_SAVED,
      }),
    ).toEqual({ kind: "refused", reason: "unsupported-page" });
  });
});
