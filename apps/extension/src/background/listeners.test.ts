import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { ExtensionConnectAnswer } from "@repo/contract/extension/extension-connect";
import type { ExtensionRequest, WorkerAnswer } from "../messages";
import { connectPageListener, ownPagesListener } from "./listeners";
import { SESSION, SIGNED_IN } from "./test-support/fake-cloud";

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// what a listener answered, as the browser hands each answer to the page that asked
const answersOf = <T>() => {
  const answers: T[] = [];
  const respond = (answer: T) => {
    answers.push(answer);
  };
  return { answers, respond };
};

const SIGNED_OUT_STATUS = {
  account: null,
  signInUrl: "http://localhost:5174/connect/extension",
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
    const { answers, respond } = answersOf<WorkerAnswer>();
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
    const { answers, respond } = answersOf<WorkerAnswer>();
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
    const { answers, respond } = answersOf<WorkerAnswer>();
    for (const [sender, message] of refused) {
      expect(listener(message, sender, respond), JSON.stringify([sender, message])).toBe(false);
    }
    expect(answers).toStrictEqual([]);
    expect(asked).toStrictEqual([]);
  });
});

describe("the connect page", () => {
  const PAGE = { origin: "https://inteligir.com", url: "https://inteligir.com/connect/extension" };
  const asked: string[] = [];
  let followed = 0;
  let signIn = async (origin: string) => {
    asked.push(origin);
    return SIGNED_IN;
  };
  const listener = connectPageListener("store", {
    answered: async () => {
      followed += 1;
    },
    signIn: async (origin) => await signIn(origin),
  });

  beforeEach(() => {
    asked.length = 0;
    followed = 0;
    signIn = async (origin) => {
      asked.push(origin);
      return SIGNED_IN;
    };
  });

  it("is answered the account the browser is signed in as on its site, and what waited goes after it", async () => {
    const { answers, respond } = answersOf<ExtensionConnectAnswer>();
    expect(listener({ type: "connect" }, PAGE, respond)).toBe(true);
    await vi.waitFor(() => {
      expect(followed).toBe(1);
    });
    expect(answers).toStrictEqual([{ email: SESSION.email }]);
    expect(asked).toStrictEqual([PAGE.origin]);
  });

  it("is answered as not connected when the sign-in could not be read or kept", async () => {
    signIn = async () => await Promise.reject(new Error("storage is full"));
    const { answers, respond } = answersOf<ExtensionConnectAnswer>();
    expect(listener({ type: "connect" }, PAGE, respond)).toBe(true);
    await vi.waitFor(() => {
      expect(answers).toStrictEqual([{ email: null }]);
    });
  });

  it("is the only sender it hears, and only with a message it parses, and asks nothing else", async () => {
    const connect = { type: "connect" } as const;
    const refused = [
      [{ origin: "https://evil.example", url: "https://evil.example/connect/extension" }, connect],
      [{ origin: PAGE.origin, url: "https://inteligir.com/library" }, connect],
      // a page that is not on the origin it claims
      [{ origin: "https://evil.example", url: PAGE.url }, connect],
      [{ url: PAGE.url }, connect],
      // the dev build's local Worker, to a store build
      [
        { origin: "http://localhost:5174", url: "http://localhost:5174/connect/extension" },
        connect,
      ],
      [PAGE, { connection: "not-a-credential", type: "connect" }],
      [PAGE, { ...connect, extra: true }],
      [PAGE, { type: "disconnect" }],
      [PAGE, null],
    ] as const;
    const { answers, respond } = answersOf<ExtensionConnectAnswer>();
    for (const [sender, message] of refused) {
      expect(listener(message, sender, respond), JSON.stringify([sender, message])).toBe(false);
    }
    expect(answers).toStrictEqual([]);
    await expect(browser.storage.local.get(null)).resolves.toStrictEqual({});
    expect(asked).toStrictEqual([]);
    expect(followed).toBe(0);
  });
});
