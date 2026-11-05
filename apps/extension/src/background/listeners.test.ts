import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { ExtensionConnectAnswer } from "@repo/contract/cloud/extension/extension-connect";
import type { ExtensionRequest, Outcome } from "../messages";
import type { Connection } from "./connection";
import { connectPageListener, ownPagesListener } from "./listeners";
import { CONNECTION } from "./test-support/fake-cloud";

beforeEach(() => {
  fakeBrowser.reset();
});

// what a listener answered, as the browser hands each answer to the page that asked
const answersOf = <T>() => {
  const answers: T[] = [];
  const respond = (answer: T) => {
    answers.push(answer);
  };
  return { answers, respond };
};

describe("the extension's own pages", () => {
  const asked: ExtensionRequest[] = [];
  const listener = ownPagesListener(async (request) => {
    asked.push(request);
    return {
      connectUrl: "http://localhost:5174/connect/extension",
      connection: null,
      kind: "status",
    };
  });
  const POPUP = { id: browser.runtime.id, url: browser.runtime.getURL("/popup.html") };

  beforeEach(() => {
    asked.length = 0;
  });

  it("are answered what they ask, once the answer is ready", async () => {
    const { answers, respond } = answersOf<Outcome>();
    expect(listener({ type: "status" }, POPUP, respond)).toBe(true);
    await vi.waitFor(() => {
      expect(answers).toMatchObject([{ connection: null, kind: "status" }]);
    });
    expect(asked).toEqual([{ type: "status" }]);
  });

  it("are the only senders it answers, and only with a message it parses", () => {
    const refused = [
      // the capture script in a web page sends under the extension's id, with that page's url
      [{ ...POPUP, url: "https://example.test/article" }, { type: "disconnect" }],
      [{ id: browser.runtime.id }, { type: "disconnect" }],
      // another extension's page
      [
        { id: "another-extension", url: "chrome-extension://another-extension/popup.html" },
        { type: "disconnect" },
      ],
      [{ id: "another-extension", url: POPUP.url }, { type: "disconnect" }],
      // an id that only begins with this one's
      [
        { ...POPUP, url: `chrome-extension://${browser.runtime.id}x/popup.html` },
        { type: "disconnect" },
      ],
      [POPUP, { type: "save" }],
      [POPUP, { tabId: 1, type: "disconnect" }],
      [POPUP, "disconnect"],
    ] as const;
    const { answers, respond } = answersOf<Outcome>();
    for (const [sender, message] of refused) {
      expect(listener(message, sender, respond), JSON.stringify([sender, message])).toBe(false);
    }
    expect(answers).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("the connect page", () => {
  const { origin: _origin, ...MINTED } = CONNECTION;
  const PAGE = { origin: "https://inteligir.com", url: "https://inteligir.com/connect/extension" };
  const revoked: Connection[] = [];
  let followed = 0;
  const listener = connectPageListener("store", {
    answered: async () => {
      followed += 1;
    },
    revoke: async (connection) => {
      revoked.push(connection);
    },
  });

  beforeEach(() => {
    revoked.length = 0;
    followed = 0;
  });

  it("hands over a credential the extension keeps, and what waited goes after it", async () => {
    const { answers, respond } = answersOf<ExtensionConnectAnswer>();
    expect(listener({ connection: MINTED, type: "connect" }, PAGE, respond)).toBe(true);
    await vi.waitFor(() => {
      expect(followed).toBe(1);
    });
    expect(answers).toEqual([{ email: MINTED.email }]);
    expect(await browser.storage.local.get(null)).toEqual({
      connection: { ...MINTED, origin: PAGE.origin },
    });
  });

  it("is the only sender it hears, and only with a message it parses, and keeps nothing else", async () => {
    const connect = { connection: MINTED, type: "connect" } as const;
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
      [PAGE, { connection: { ...MINTED, credential: "not-a-credential" }, type: "connect" }],
      [PAGE, { ...connect, extra: true }],
      [PAGE, { type: "disconnect" }],
      [PAGE, null],
    ] as const;
    const { answers, respond } = answersOf<ExtensionConnectAnswer>();
    for (const [sender, message] of refused) {
      expect(listener(message, sender, respond), JSON.stringify([sender, message])).toBe(false);
    }
    expect(answers).toEqual([]);
    expect(await browser.storage.local.get(null)).toEqual({});
    expect(followed).toBe(0);
    expect(revoked).toEqual([]);
  });
});
