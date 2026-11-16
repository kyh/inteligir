import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { ExtensionRequest, WorkerAnswer } from "../messages";
import { ownPagesListener } from "./listeners";

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// what the listener answered, as the browser hands each answer to the page that asked
const answersOf = () => {
  const answers: WorkerAnswer[] = [];
  const respond = (answer: WorkerAnswer) => {
    answers.push(answer);
  };
  return { answers, respond };
};

const SIGNED_OUT_STATUS = {
  account: null,
  signInUrl: "http://localhost:5174/app/sign-in",
} as const;

describe("the extension's own pages", () => {
  const asked: ExtensionRequest[] = [];
  const listener = ownPagesListener(async (request) => {
    asked.push(request);
    return SIGNED_OUT_STATUS;
  });
  const POPUP = { id: browser.runtime.id, url: browser.runtime.getURL("/popup.html") };

  beforeEach(() => {
    asked.length = 0;
  });

  it("are answered what they ask, once the answer is ready", async () => {
    const { answers, respond } = answersOf();
    expect(listener({ type: "status" }, POPUP, respond)).toBe(true);
    await vi.waitFor(() => {
      expect(answers).toStrictEqual([SIGNED_OUT_STATUS]);
    });
    expect(asked).toStrictEqual([{ type: "status" }]);
  });

  it("are answered a failure when the work behind the answer failed", async () => {
    const failing = ownPagesListener(async () => {
      await Promise.reject(new Error("storage is full"));
      return SIGNED_OUT_STATUS;
    });
    const { answers, respond } = answersOf();
    expect(failing({ type: "status" }, POPUP, respond)).toBe(true);
    await vi.waitFor(() => {
      expect(answers).toStrictEqual([{ kind: "refused", reason: "failed" }]);
    });
  });

  it("are the only senders it answers, and only with a message it parses", () => {
    const refused = [
      // the capture script in a web page sends under the extension's id, with that page's url
      [{ ...POPUP, url: "https://example.test/article" }, { type: "status" }],
      [{ id: browser.runtime.id }, { type: "status" }],
      // another extension's page
      [
        { id: "another-extension", url: "chrome-extension://another-extension/popup.html" },
        { type: "status" },
      ],
      [{ id: "another-extension", url: POPUP.url }, { type: "status" }],
      // an id that only begins with this one's
      [
        { ...POPUP, url: `chrome-extension://${browser.runtime.id}x/popup.html` },
        { type: "status" },
      ],
      [POPUP, { type: "save" }],
      [POPUP, { tabId: 1, type: "status" }],
      [POPUP, "status"],
      // the extension has no sign-out of its own: the site's signs it out
      [POPUP, { type: "disconnect" }],
    ] as const;
    const { answers, respond } = answersOf();
    for (const [sender, message] of refused) {
      expect(listener(message, sender, respond), JSON.stringify([sender, message])).toBe(false);
    }
    expect(answers).toStrictEqual([]);
    expect(asked).toStrictEqual([]);
  });
});
