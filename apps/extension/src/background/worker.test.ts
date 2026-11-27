import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { deferred } from "@repo/contract/deferred";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import worker from "../entrypoints/background";
import type { ExtensionRequest, WorkerAnswer } from "../messages";
import { keepConnection } from "./connection";
import { keepSave, queuedSaves, SEND_ALARM } from "./save-queue";
import { KEPT, SESSION } from "./test-support/fake-cloud.test-utils";

const WAITING = {
  id: "01900000-0000-7000-8000-000000000001",
  opId: "01900000-0000-7000-8000-0000000000a1",
  payload: {
    email: SESSION.email,
    title: "File over app",
    url: "https://example.test/file-over-app",
  },
  refused: null,
  savedAt: Date.UTC(2026, 10, 5, 12),
};

const SESSION_COOKIE: Browser.cookies.Cookie = {
  domain: "localhost",
  hostOnly: true,
  httpOnly: true,
  name: "better-auth.session_token",
  path: "/",
  sameSite: "lax",
  secure: false,
  session: false,
  storeId: "0",
  value: SESSION.bearer,
};

const jarHolds = (held: boolean) => {
  fakeBrowser.cookies.get = async (details: Browser.cookies.CookieDetails) =>
    held && details.name === SESSION_COOKIE.name && new URL(details.url).origin === SESSION.origin
      ? SESSION_COOKIE
      : null;
};

const jarListeners: ((change: Browser.cookies.CookieChangeInfo) => void)[] = [];

const jarTells = (cause: "explicit" | "overwrite") => {
  for (const listener of jarListeners) {
    listener({ cause, cookie: SESSION_COOKIE, removed: cause === "overwrite" });
  }
};

const GET_SESSION = "/api/auth/get-session";
const SAVE_LINK = "/v1/rpc/library/items/saveLink";

const FULL = "Your library is full.";
const NONE_HELD = { refused: [], waiting: 0 };

const refusesFull = () =>
  Response.json(
    {
      json: { code: "QUOTA", data: { bytesCap: 1, bytesUsed: 1 }, defined: true, message: FULL },
    },
    { status: 507 },
  );

const lands = () =>
  Response.json({ json: { created: true, item: { fields: { title: "File over app" } } } });

const cloudAnswers = (saveLink?: () => Response) => {
  const asked: string[] = [];
  const bearers: (string | null)[] = [];
  network.use(
    http.all("*", ({ request }) => {
      const { pathname } = new URL(request.url);
      asked.push(pathname);
      bearers.push(request.headers.get("authorization"));

      if (pathname === GET_SESSION) {
        return Response.json({
          session: { id: "session-1" },
          user: { email: SESSION.email, id: "reader" },
        });
      }

      if (pathname === SAVE_LINK && saveLink !== undefined) {
        return saveLink();
      }

      return HttpResponse.error();
    }),
  );

  return { asked, bearers };
};

const alarmStands = async () => {
  const alarm = await browser.alarms.get(SEND_ALARM);

  return alarm !== undefined;
};

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
    manifest_version: 3,
    name: "Inteligir",
    version: "0.6.0",
  });
  vi.spyOn(browser.contextMenus.onClicked, "addListener").mockImplementation(() => {});
  jarListeners.length = 0;
  vi.spyOn(browser.cookies.onChanged, "addListener").mockImplementation((listener) => {
    jarListeners.push(listener);
  });
  vi.spyOn(browser.storage.local, "setAccessLevel").mockResolvedValue();
  await keepConnection(KEPT);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const network = setupServer();

beforeAll(() => {
  network.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  network.resetHandlers();
});

afterAll(() => {
  network.close();
});

const PAGE = { id: browser.runtime.id, url: browser.runtime.getURL("/welcome.html") };

const ask = async (request: ExtensionRequest) => {
  const answered = deferred<WorkerAnswer>();
  void fakeBrowser.runtime.onMessage.trigger(request, PAGE, (answer: WorkerAnswer) => {
    answered.resolve(answer);
  });

  return await answered.promise;
};

describe("the worker", () => {
  it("sends what waited as it starts where no alarm stands, under the browser's session, and holds the alarm for a call the cloud left unanswered", async () => {
    jarHolds(true);
    await keepSave(WAITING);
    const { asked, bearers } = cloudAnswers();
    worker.main();
    await vi.waitFor(async () => {
      await expect(alarmStands()).resolves.toBe(true);
    });
    expect(asked).toStrictEqual([GET_SESSION, SAVE_LINK]);
    expect(bearers[1]).toBe(`Bearer ${SESSION.bearer}`);
    await expect(queuedSaves()).resolves.toHaveLength(1);
  });

  it("leaves what waits to the alarm where one stands, which sends it in one pass", async () => {
    jarHolds(true);
    await keepSave(WAITING);
    await browser.alarms.create(SEND_ALARM, { periodInMinutes: 0.5 });
    const { asked } = cloudAnswers();
    worker.main();
    await ask({ type: "status" });
    expect(asked).toStrictEqual([GET_SESSION]);
    await fakeBrowser.alarms.onAlarm.trigger({
      name: SEND_ALARM,
      persistAcrossSessions: true,
      scheduledTime: Date.now(),
    });
    await vi.waitFor(() => {
      expect(asked).toStrictEqual([GET_SESSION, GET_SESSION, SAVE_LINK]);
    });
  });

  it("sends a save that waited for its account as the site signs it in, told by the jar's cookie", async () => {
    jarHolds(false);
    await keepSave(WAITING);
    const { asked } = cloudAnswers();
    worker.main();
    await ask({ type: "status" });
    expect(asked).toStrictEqual([]);
    await expect(alarmStands()).resolves.toBe(false);
    jarHolds(true);
    jarTells("overwrite");
    await ask({ type: "status" });
    expect(asked).toStrictEqual([GET_SESSION]);
    jarTells("explicit");
    await vi.waitFor(() => {
      expect(asked).toStrictEqual([GET_SESSION, GET_SESSION, SAVE_LINK]);
    });
  });

  it("says whose library this browser saves to, as the site's session reads, and where to sign in", async () => {
    jarHolds(true);
    cloudAnswers();
    worker.main();
    await expect(ask({ type: "status" })).resolves.toStrictEqual({
      account: { email: SESSION.email, libraryUrl: `${SESSION.origin}/library` },
      signInUrl: `${SESSION.origin}/app/sign-in`,
    });
  });

  it("is signed out once the site signed out, which leaves no session in the jar, and asks nobody", async () => {
    jarHolds(false);
    const { asked } = cloudAnswers();
    worker.main();
    await expect(ask({ type: "status" })).resolves.toStrictEqual({
      account: null,
      signInUrl: `${SESSION.origin}/app/sign-in`,
    });
    expect(asked).toStrictEqual([]);
  });

  it("sends a store build to the production site's sign-in", async () => {
    vi.stubEnv("MODE", "store");
    jarHolds(false);
    cloudAnswers();
    worker.main();
    await expect(ask({ type: "status" })).resolves.toStrictEqual({
      account: null,
      signInUrl: "https://www.inteligir.com/app/sign-in",
    });
  });

  it("has no sign-out of its own: the site's signs it out, and what waits stays", async () => {
    jarHolds(false);
    await keepSave(WAITING);
    cloudAnswers();
    worker.main();
    await expect(
      fakeBrowser.runtime.onMessage.trigger({ type: "disconnect" }, PAGE, () => {}),
    ).resolves.toStrictEqual([false]);
    await expect(queuedSaves()).resolves.toHaveLength(1);
  });

  it("keeps a save the library refused for its popup, and sends it again as the popup asks", async () => {
    jarHolds(true);
    await keepSave(WAITING);
    let answer = refusesFull;
    const { asked } = cloudAnswers(() => answer());
    worker.main();

    const parked = {
      refused: [{ message: FULL, name: "File over app", opId: WAITING.opId }],
      waiting: 0,
    };

    await vi.waitFor(async () => {
      await expect(ask({ type: "saves" })).resolves.toStrictEqual(parked);
    });
    await expect(ask({ opId: WAITING.opId, type: "retry" })).resolves.toStrictEqual(parked);
    answer = lands;
    await expect(ask({ opId: WAITING.opId, type: "retry" })).resolves.toStrictEqual(NONE_HELD);
    expect(asked.filter((pathname) => pathname === SAVE_LINK)).toHaveLength(3);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("lets a refused save go as the popup asks, and lists none to a browser signed out", async () => {
    jarHolds(true);
    await keepSave(WAITING);
    cloudAnswers(refusesFull);
    worker.main();
    await vi.waitFor(async () => {
      await expect(ask({ type: "saves" })).resolves.toMatchObject({ refused: [{}] });
    });
    jarHolds(false);
    await expect(ask({ type: "saves" })).resolves.toStrictEqual(NONE_HELD);
    jarHolds(true);
    await expect(ask({ opId: WAITING.opId, type: "discard" })).resolves.toStrictEqual(NONE_HELD);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });
});
