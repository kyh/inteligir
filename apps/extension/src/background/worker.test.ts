import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import worker from "../entrypoints/background";
import type { ExtensionRequest, WorkerAnswer } from "../messages";
import { keepConnection } from "./connection";
import { keepSave, queuedSaves, SEND_ALARM } from "./save-queue";
import { SESSION } from "./test-support/fake-cloud";

const WAITING = {
  email: SESSION.email,
  firstTry: false,
  id: "01900000-0000-7000-8000-000000000001",
  opId: "01900000-0000-7000-8000-0000000000a1",
  savedAt: Date.UTC(2026, 10, 5, 12),
  title: "File over app",
  url: "https://example.test/file-over-app",
};

// the local Worker's session cookie, as Better Auth names it on plain http
const COOKIE_NAME = "better-auth.session_token";

// the browser's jar at the cloud, holding the session cookie or not
const jarHolds = (value: string | null): void => {
  fakeBrowser.cookies.get = async (
    details: Browser.cookies.CookieDetails,
  ): Promise<Browser.cookies.Cookie | null> =>
    value === null || details.name !== COOKIE_NAME || new URL(details.url).origin !== SESSION.origin
      ? null
      : {
          domain: "localhost",
          hostOnly: true,
          httpOnly: true,
          name: COOKIE_NAME,
          path: "/",
          sameSite: "lax",
          secure: false,
          session: false,
          storeId: "0",
          value,
        };
};

// the cloud: get-session answers the account, and every other call goes unanswered
const cloudAnswers = () => {
  const asked: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      asked.push(request);
      if (new URL(request.url).pathname === "/api/auth/get-session") {
        return Response.json({
          session: { id: "session-1" },
          user: { email: SESSION.email, id: "reader" },
        });
      }
      throw new TypeError("Failed to fetch");
    }),
  );
  return asked;
};

// the calls the fake browser leaves out, which the worker makes
beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
    manifest_version: 3,
    name: "Inteligir",
    version: "0.6.0",
  });
  vi.spyOn(browser.runtime.onMessageExternal, "addListener").mockImplementation(() => {});
  vi.spyOn(browser.contextMenus.onClicked, "addListener").mockImplementation(() => {});
  vi.spyOn(browser.storage.local, "setAccessLevel").mockResolvedValue();
  await keepConnection({ email: SESSION.email, origin: SESSION.origin });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const PAGE = { id: browser.runtime.id, url: browser.runtime.getURL("/welcome.html") };

// what the worker answers one of its own pages
const ask = async (request: ExtensionRequest): Promise<WorkerAnswer | undefined> => {
  const answers: WorkerAnswer[] = [];
  void fakeBrowser.runtime.onMessage.trigger(request, PAGE, (answer: WorkerAnswer) => {
    answers.push(answer);
  });
  await vi.waitFor(() => {
    expect(answers).toHaveLength(1);
  });
  return answers[0];
};

describe("the worker", () => {
  it("sends what waited as the browser starts, under the browser's session, and holds the alarm a restart may have cleared", async () => {
    jarHolds("session-token.signature");
    await keepSave(WAITING);
    await browser.alarms.clearAll();
    const asked = cloudAnswers();
    worker.main();
    await fakeBrowser.runtime.onStartup.trigger();
    await vi.waitFor(() => {
      expect(asked.map((request) => new URL(request.url).pathname)).toStrictEqual([
        "/api/auth/get-session",
        "/v1/rpc/library/items/saveLink",
      ]);
    });
    expect(asked[1]?.headers.get("authorization")).toBe("Bearer session-token.signature");
    await vi.waitFor(async () => {
      await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
    });
    await expect(queuedSaves()).resolves.toHaveLength(1);
  });

  it("says whose library this browser saves to, as the site's session reads, and where to sign in", async () => {
    jarHolds("session-token.signature");
    cloudAnswers();
    worker.main();
    await expect(ask({ type: "status" })).resolves.toStrictEqual({
      account: { email: SESSION.email, libraryUrl: `${SESSION.origin}/library` },
      signInUrl: `${SESSION.origin}/connect/extension`,
    });
  });

  it("is signed out once the site signed out, which leaves no session in the jar, and asks nobody", async () => {
    jarHolds(null);
    const asked = cloudAnswers();
    worker.main();
    await expect(ask({ type: "status" })).resolves.toStrictEqual({
      account: null,
      signInUrl: `${SESSION.origin}/connect/extension`,
    });
    expect(asked).toStrictEqual([]);
  });

  it("sends a store build to the site's own sign-in", async () => {
    vi.stubEnv("MODE", "store");
    jarHolds(null);
    cloudAnswers();
    worker.main();
    await expect(ask({ type: "status" })).resolves.toStrictEqual({
      account: null,
      signInUrl: `${SESSION.origin}/app/sign-in`,
    });
  });

  it("has no sign-out of its own: the site's signs it out, and what waits stays", async () => {
    jarHolds("session-token.signature");
    await keepSave(WAITING);
    worker.main();
    await expect(
      fakeBrowser.runtime.onMessage.trigger({ type: "disconnect" }, PAGE, () => {}),
    ).resolves.toStrictEqual([false]);
    await expect(queuedSaves()).resolves.toHaveLength(1);
  });
});
