import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { keepConnection, readConnection } from "./connection";
import { cloudSignIn, heldSignIn, saveSignIn, setsSession } from "./sign-in";
import { keptAs } from "./test-support/fake-cloud";

// the cloud a store build rides, and the dev build's
const SITE = "https://inteligir.com";
const LOCAL = "http://localhost:5174";
const storeBuild = (): void => {
  vi.stubEnv("MODE", "store");
};
const COOKIE = "session-token.c2lnbmF0dXJl%3D";
const EMAIL = "reader@example.test";
// the account as the cloud read it under the cookie
const KEPT = keptAs(EMAIL, COOKIE);
// the cookie a sign-in as another account leaves in the jar
const OTHER_COOKIE = "other-token.c2lnbmF0dXJl%3D";
const OTHER_EMAIL = "someone-else@example.test";

const cookieOf = (url: string, name: string, value: string): Browser.cookies.Cookie => ({
  domain: new URL(url).hostname,
  hostOnly: true,
  httpOnly: true,
  name,
  path: "/",
  sameSite: "lax",
  secure: url.startsWith("https:"),
  session: false,
  storeId: "0",
  value,
});

// the browser's jar, holding each value under its site and cookie name; WXT's fake browser has none
const jarHolds = (cookies: Readonly<Record<string, string>>): void => {
  fakeBrowser.cookies.get = async (
    details: Browser.cookies.CookieDetails,
  ): Promise<Browser.cookies.Cookie | null> => {
    const value = cookies[`${new URL(details.url).origin} ${details.name}`];
    return value === undefined ? null : cookieOf(details.url, details.name, value);
  };
};

// the cloud's get-session, answering as the case says, with every request it was asked
const cloudAnswers = (answer: () => Promise<Response>) => {
  const asked: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      asked.push(new Request(input, init));
      return await answer();
    }),
  );
  return asked;
};

const sessionOf = (email: string) =>
  Response.json({ session: { id: "session-1" }, user: { email, id: "reader" } });

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the browser's sign-in, asked of the cloud", () => {
  it("sends the jar's session cookie as get-session's bearer, with the browser's credentials, and keeps the account it names", async () => {
    storeBuild();
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    const asked = cloudAnswers(async () => sessionOf(EMAIL));
    await expect(cloudSignIn()).resolves.toStrictEqual({
      kind: "signed-in",
      session: { bearer: COOKIE, email: EMAIL, origin: SITE },
    });
    const [request] = asked;
    expect(request?.url).toBe(`${SITE}/api/auth/get-session`);
    expect(request?.headers.get("authorization")).toBe(`Bearer ${COOKIE}`);
    expect(request?.credentials).toBe("include");
    // the account and its cookie's SHA-256, never the cookie
    await expect(readConnection()).resolves.toStrictEqual(KEPT);
  });

  it("reads the cookie Better Auth names on plain http, a local Worker's", async () => {
    jarHolds({
      [`${LOCAL} __Secure-better-auth.session_token`]: "the wrong one",
      [`${LOCAL} better-auth.session_token`]: COOKIE,
    });
    const asked = cloudAnswers(async () => sessionOf(EMAIL));
    await expect(cloudSignIn()).resolves.toMatchObject({ kind: "signed-in" });
    expect(asked[0]?.headers.get("authorization")).toBe(`Bearer ${COOKIE}`);
  });

  it("is signed out, as the account last signed in, once the site signed out or the cloud ended the session", async () => {
    storeBuild();
    await keepConnection(KEPT);
    jarHolds({});
    const asked = cloudAnswers(async () => sessionOf(EMAIL));
    await expect(cloudSignIn()).resolves.toStrictEqual({ email: EMAIL, kind: "signed-out" });
    expect(asked).toStrictEqual([]);
    vi.restoreAllMocks();
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    cloudAnswers(async () => Response.json(null));
    await expect(cloudSignIn()).resolves.toStrictEqual({ email: EMAIL, kind: "signed-out" });
    await expect(readConnection()).resolves.toStrictEqual(KEPT);
  });

  it("names no account where none was ever signed in", async () => {
    jarHolds({});
    await expect(cloudSignIn()).resolves.toStrictEqual({ kind: "none" });
  });

  it("says nothing of the session when the cloud did not answer, or answered a fault of its own", async () => {
    storeBuild();
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    cloudAnswers(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(cloudSignIn()).resolves.toBeNull();
    vi.unstubAllGlobals();
    cloudAnswers(async () => new Response("down", { status: 503 }));
    await expect(cloudSignIn()).resolves.toBeNull();
    await expect(readConnection()).resolves.toBeNull();
  });
});

// whether the jar's telling of a cookie's write, or of the removal a rewrite starts with, reads as
// a sign-in
const told = (name: string, cause: "explicit" | "overwrite"): boolean =>
  setsSession({ cause, cookie: cookieOf(SITE, name, COOKIE), removed: cause === "overwrite" });

describe("a change the jar tells of", () => {
  it("is a sign-in only as a session cookie set, under either name Better Auth gives it", () => {
    expect(told("__Secure-better-auth.session_token", "explicit")).toBe(true);
    expect(told("better-auth.session_token", "explicit")).toBe(true);
    // a rewrite is told as the removal of the cookie it replaces, then as the write
    expect(told("better-auth.session_token", "overwrite")).toBe(false);
    expect(told("better-auth.dont_remember", "explicit")).toBe(false);
  });
});

describe("the sign-in a save goes under", () => {
  it("is the account's, asked of nobody, while the jar holds the cookie the cloud read it under", async () => {
    storeBuild();
    await keepConnection(KEPT);
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    const asked = cloudAnswers(async () => sessionOf(OTHER_EMAIL));
    await expect(saveSignIn()).resolves.toStrictEqual({
      kind: "signed-in",
      session: { bearer: COOKIE, email: EMAIL, origin: SITE },
    });
    expect(asked).toStrictEqual([]);
  });

  it("is the account the cloud names once the jar holds another cookie, never the last account under it", async () => {
    storeBuild();
    await keepConnection(KEPT);
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: OTHER_COOKIE });
    await expect(heldSignIn()).resolves.toStrictEqual({ kind: "none" });
    const asked = cloudAnswers(async () => sessionOf(OTHER_EMAIL));
    await expect(saveSignIn()).resolves.toStrictEqual({
      kind: "signed-in",
      session: { bearer: OTHER_COOKIE, email: OTHER_EMAIL, origin: SITE },
    });
    expect(asked).toHaveLength(1);
    await expect(readConnection()).resolves.toStrictEqual(keptAs(OTHER_EMAIL, OTHER_COOKIE));
  });

  it("is nobody's while the cloud has yet to say whose the jar's other cookie is, so no save goes or waits under the last account", async () => {
    storeBuild();
    await keepConnection(KEPT);
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: OTHER_COOKIE });
    cloudAnswers(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(saveSignIn()).resolves.toStrictEqual({ kind: "none" });
    await expect(readConnection()).resolves.toStrictEqual(KEPT);
  });

  it("is signed out when the jar holds no cookie, as the site's sign-out leaves it", async () => {
    await keepConnection(KEPT);
    jarHolds({});
    await expect(heldSignIn()).resolves.toStrictEqual({ email: EMAIL, kind: "signed-out" });
  });

  it("asks the cloud once in a browser never read signed in, so a sign-in on the site saves at the first click", async () => {
    jarHolds({ [`${LOCAL} better-auth.session_token`]: COOKIE });
    const asked = cloudAnswers(async () => sessionOf(EMAIL));
    await expect(saveSignIn()).resolves.toStrictEqual({
      kind: "signed-in",
      session: { bearer: COOKIE, email: EMAIL, origin: LOCAL },
    });
    expect(asked).toHaveLength(1);
  });
});
