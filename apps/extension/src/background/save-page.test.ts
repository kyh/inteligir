import { fileSha } from "@repo/contract/library/file-sha";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { CapturedPage } from "../capture/captured-page";
import type { Outcome } from "../messages";
import { CAPTURE_DEADLINE_MS } from "./capture-tab";
import { keepConnection, readConnection } from "./connection";
import { saveAddress, savePicture, saveTab } from "./save-page";
import type { SaveDeps } from "./save-page";
import { queuedSaves, SEND_ALARM } from "./save-queue";
import type { SignIn } from "./sign-in";
import {
  fakeCloud,
  OTHER_SESSION,
  refusal,
  savedAs,
  SESSION,
  SIGNED_IN,
  SIGNED_OUT,
} from "./test-support/fake-cloud";
import type { FakeCloud } from "./test-support/fake-cloud";

const KEPT = { email: SESSION.email, origin: SESSION.origin };

beforeEach(async () => {
  fakeBrowser.reset();
  await keepConnection(KEPT);
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
  title: "File over app",
  url: URL_SAVED,
  ...overrides,
});

const answering = (status: number) => async () => new Response(null, { status });

const refusedFor = (reason: Extract<Outcome, { kind: "refused" }>["reason"]): Outcome => ({
  kind: "refused",
  reason,
});

const NONE: SignIn = { kind: "none" };

let seq = 0;

const depsWith = (
  cloud: FakeCloud,
  options: { captured?: CapturedPage | null; signIn?: SignIn } = {},
) => {
  const covers: string[] = [];
  const captures: number[] = [];
  const deps: SaveDeps = {
    capture: async (tabId) => {
      captures.push(tabId);
      return options.captured === undefined ? page() : options.captured;
    },
    cloud: () => cloud.cloud,
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
    signIn: async () => options.signIn ?? SIGNED_IN,
  };
  return { captures, covers, deps };
};

describe("a tab saved", () => {
  it("is read here and saved read: its article, its facts and its cover", async () => {
    const cloud = fakeCloud({});
    const run = depsWith(cloud);
    await expect(saveTab(run.deps, { tab: TAB })).resolves.toStrictEqual({
      created: true,
      kind: "saved",
      title: "File over app",
    });
    const [save] = cloud.saves;
    expect(save).toMatchObject({
      coverSha: fileSha(PNG),
      facts: { author: "Steph Ango" },
      folderId: null,
      tags: [],
      title: "File over app",
      url: URL_SAVED,
    });
    expect(JSON.stringify(save?.article)).toContain(PASSAGE);
    expect(cloud.uploads).toStrictEqual([{ bytes: PNG, mime: "image/png", sha: fileSha(PNG) }]);
    // a public page never sends this browser into the person's own network
    expect(run.covers).toStrictEqual(["https://cdn.example.test/cover.png"]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("keeps a video's description as its article, as every device reads it", async () => {
    const url = "https://www.youtube.com/watch?v=abc123";
    const video = [
      "<!doctype html>",
      '<html lang="en"><head><title>A talk</title>',
      '<meta name="description" content="What the talk is about.">',
      "</head><body><article>",
      `<p>${"The words around the video. ".repeat(20)}</p>`,
      "</article></body></html>",
    ].join("\n");
    const cloud = fakeCloud({});
    await saveTab(depsWith(cloud, { captured: page({ html: video, url }) }).deps, {
      tab: { ...TAB, url },
    });
    const article = JSON.stringify(cloud.saves[0]?.article);
    expect(article).toContain("What the talk is about.");
    expect(article).not.toContain("The words around the video.");
  });

  it("says a page the library holds is already in it", async () => {
    const cloud = fakeCloud({ save: async () => savedAs("File over app", false) });
    await expect(saveTab(depsWith(cloud).deps, { tab: TAB })).resolves.toMatchObject({
      created: false,
    });
  });

  it("is saved without a cover the cloud refuses, and waits with a cover whose session ended", async () => {
    const refused = fakeCloud({ upload: answering(413) });
    await expect(saveTab(depsWith(refused).deps, { tab: TAB })).resolves.toMatchObject({
      kind: "saved",
    });
    expect(refused.saves).toStrictEqual([expect.objectContaining({ coverSha: null })]);
    const ended = fakeCloud({ upload: answering(401) });
    await expect(saveTab(depsWith(ended).deps, { tab: TAB })).resolves.toStrictEqual({
      kind: "queued",
      waitsFor: "sign-in",
    });
    expect(ended.saves).toStrictEqual([]);
    await expect(queuedSaves()).resolves.toStrictEqual([
      expect.objectContaining({ firstTry: false, url: URL_SAVED }),
    ]);
  });

  it("is saved as its link when it cannot be scripted", async () => {
    const cloud = fakeCloud({});
    const run = depsWith(cloud, { captured: null });
    await saveTab(run.deps, { tab: TAB });
    expect(cloud.saves).toStrictEqual([]);
    expect(cloud.links).toStrictEqual([
      expect.objectContaining({ title: TAB.title, url: URL_SAVED }),
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
    expect(cloud.links).toStrictEqual([expect.objectContaining({ url: URL_SAVED })]);
  });

  it("is saved as its link, for the cloud to read, when it held no text the reader could keep", async () => {
    const shell = [
      "<!doctype html>",
      '<html lang="en"><head><title>A shell</title>',
      '<meta name="description" content="A page its scripts have yet to draw.">',
      '</head><body><div id="root"></div></body></html>',
    ].join("\n");
    const cloud = fakeCloud({});
    await saveTab(depsWith(cloud, { captured: page({ html: shell, title: "A shell" }) }).deps, {
      tab: TAB,
    });
    expect(cloud.saves).toStrictEqual([]);
    expect(cloud.links).toStrictEqual([
      expect.objectContaining({ title: "A shell", url: URL_SAVED }),
    ]);
  });

  it("is saved as its link when the cloud will not take its reading as a call", async () => {
    for (const [code, defined] of [
      ["BAD_REQUEST", false],
      ["PAYLOAD_TOO_LARGE", true],
      ["CONFLICT", true],
    ] as const) {
      const cloud = fakeCloud({ save: refusal(code, defined) });
      await expect(saveTab(depsWith(cloud).deps, { tab: TAB }), code).resolves.toMatchObject({
        created: true,
        kind: "saved",
      });
      const [save] = cloud.saves;
      expect(cloud.links, code).toStrictEqual([
        expect.objectContaining({
          id: save?.id,
          opId: save?.opId,
          url: URL_SAVED,
        }),
      ]);
      await expect(queuedSaves()).resolves.toStrictEqual([]);
    }
  });

  it("sends no link past an answer the link would meet as well", async () => {
    for (const code of ["QUOTA", "CLIENT_OUTDATED", "UNAUTHORIZED", "GONE"]) {
      const cloud = fakeCloud({ save: refusal(code) });
      await saveTab(depsWith(cloud).deps, { tab: TAB });
      expect(cloud.links, code).toStrictEqual([]);
    }
  });

  it("waits, as its address and title alone, when the cloud does not answer", async () => {
    const cloud = fakeCloud({
      save: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(saveTab(depsWith(cloud).deps, { tab: TAB })).resolves.toStrictEqual({
      kind: "queued",
      waitsFor: "connection",
    });
    const [queued] = await queuedSaves();
    expect(queued).toMatchObject({
      email: SESSION.email,
      title: "File over app",
      url: URL_SAVED,
    });
    expect(Object.keys(queued ?? {}).toSorted()).toStrictEqual([
      "email",
      "firstTry",
      "id",
      "opId",
      "savedAt",
      "title",
      "url",
    ]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
  });

  it("is kept in the queue, the alarm standing, before its first call goes", async () => {
    let queuedAtCall: number | null = null;
    let alarmAtCall: Browser.alarms.Alarm | undefined;
    const cloud = fakeCloud({
      save: async () => {
        const queued = await queuedSaves();
        queuedAtCall = queued.length;
        alarmAtCall = await browser.alarms.get(SEND_ALARM);
        return savedAs("File over app");
      },
    });
    await saveTab(depsWith(cloud).deps, { tab: TAB });
    expect(queuedAtCall).toBe(1);
    expect(alarmAtCall).toBeDefined();
  });

  it("waits unread, as its address and title, while the browser is signed out of its account", async () => {
    const cloud = fakeCloud({});
    const run = depsWith(cloud, { signIn: SIGNED_OUT });
    await expect(saveTab(run.deps, { tab: TAB })).resolves.toStrictEqual({
      kind: "queued",
      waitsFor: "sign-in",
    });
    expect(run.captures).toStrictEqual([]);
    expect(cloud.saves).toStrictEqual([]);
    expect(cloud.links).toStrictEqual([]);
    await expect(queuedSaves()).resolves.toStrictEqual([
      expect.objectContaining({
        email: SESSION.email,
        firstTry: false,
        title: TAB.title,
        url: URL_SAVED,
      }),
    ]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
  });

  it("keeps the account a sign-in as another replaced while its call was on its way", async () => {
    const replaced = { email: OTHER_SESSION.email, origin: OTHER_SESSION.origin };
    const cloud = fakeCloud({
      save: async () => {
        await keepConnection(replaced);
        return await refusal("GONE")();
      },
    });
    await expect(saveTab(depsWith(cloud).deps, { tab: TAB })).resolves.toStrictEqual({
      kind: "refused",
      reason: "not-connected",
    });
    await expect(readConnection()).resolves.toStrictEqual(replaced);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("asks for a sign-in first, and saves nothing off the web", async () => {
    const cloud = fakeCloud({});
    for (const signIn of [SIGNED_IN, SIGNED_OUT]) {
      await expect(
        saveTab(depsWith(cloud, { signIn }).deps, { tab: { ...TAB, url: "chrome://settings" } }),
      ).resolves.toStrictEqual({ kind: "refused", reason: "unsupported-page" });
    }
    await expect(
      saveTab(depsWith(cloud, { signIn: NONE }).deps, { tab: TAB }),
    ).resolves.toStrictEqual({
      kind: "refused",
      reason: "not-connected",
    });
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

  it("keeps an address for its account to sign in again, and asks for a sign-in where none was", async () => {
    const cloud = fakeCloud({});
    const url = "https://example.test/a-link";
    await expect(
      saveAddress(depsWith(cloud, { signIn: SIGNED_OUT }).deps, url),
    ).resolves.toStrictEqual({ kind: "queued", waitsFor: "sign-in" });
    await expect(queuedSaves()).resolves.toStrictEqual([
      expect.objectContaining({ email: SESSION.email, title: "", url }),
    ]);
    await expect(saveAddress(depsWith(cloud, { signIn: NONE }).deps, url)).resolves.toStrictEqual({
      kind: "refused",
      reason: "not-connected",
    });
    expect(cloud.links).toStrictEqual([]);
  });

  it("saves a picture a page drew from its bytes as a file, named after the page", async () => {
    const cloud = fakeCloud({});
    await expect(
      savePicture(depsWith(cloud).deps, { bytes: PNG, pageUrl: URL_SAVED }),
    ).resolves.toMatchObject({
      created: true,
      kind: "saved",
    });
    expect(cloud.uploads).toStrictEqual([{ bytes: PNG, mime: "image/png", sha: fileSha(PNG) }]);
    expect(cloud.files).toStrictEqual([
      expect.objectContaining({ name: "file-over-app.png", sha: fileSha(PNG) }),
    ]);
  });

  it("refuses a picture whatever would keep a save waiting, since its bytes wait in no queue", async () => {
    const rows: readonly (readonly [string, FakeCloud, Outcome, boolean])[] = [
      ["401", fakeCloud({ upload: answering(401) }), refusedFor("signed-out"), true],
      ["410", fakeCloud({ upload: answering(410) }), refusedFor("not-connected"), false],
      ["426", fakeCloud({ upload: answering(426) }), refusedFor("update-extension"), true],
      ["413", fakeCloud({ upload: answering(413) }), refusedFor("too-large"), true],
      ["507", fakeCloud({ upload: answering(507) }), refusedFor("library-full"), true],
      ["400", fakeCloud({ upload: answering(400) }), refusedFor("failed"), true],
      ["429", fakeCloud({ upload: answering(429) }), refusedFor("needs-connection"), true],
      ["503", fakeCloud({ upload: answering(503) }), refusedFor("needs-connection"), true],
      [
        "no answer",
        fakeCloud({
          upload: async () => {
            throw new TypeError("Failed to fetch");
          },
        }),
        refusedFor("needs-connection"),
        true,
      ],
      [
        "the file's create refused",
        fakeCloud({ createFile: refusal("QUOTA") }),
        refusedFor("library-full"),
        true,
      ],
    ];
    for (const [met, cloud, outcome, accountKept] of rows) {
      await keepConnection(KEPT);
      await expect(
        savePicture(depsWith(cloud).deps, { bytes: PNG, pageUrl: URL_SAVED }),
        met,
      ).resolves.toStrictEqual(outcome);
      await expect(readConnection(), met).resolves.toStrictEqual(accountKept ? KEPT : null);
      await expect(queuedSaves(), met).resolves.toStrictEqual([]);
    }
  });

  it("asks a signed-out picture's account to sign in again before sending anything, and refuses what is no picture", async () => {
    const quiet = fakeCloud({});
    await expect(
      savePicture(depsWith(quiet, { signIn: SIGNED_OUT }).deps, { bytes: PNG, pageUrl: URL_SAVED }),
    ).resolves.toStrictEqual({ kind: "refused", reason: "signed-out" });
    await expect(
      savePicture(depsWith(quiet).deps, {
        bytes: new TextEncoder().encode("not a picture"),
        pageUrl: URL_SAVED,
      }),
    ).resolves.toStrictEqual({ kind: "refused", reason: "unsupported-page" });
    expect(quiet.uploads).toStrictEqual([]);
  });
});
