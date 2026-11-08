import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { keepConnection, readConnection } from "./connection";
import { askedSignIn, heldSignIn, saveSignIn } from "./sign-in";

const SITE = "https://inteligir.com";
const LOCAL = "http://localhost:5174";
const COOKIE = "session-token.c2lnbmF0dXJl%3D";
const EMAIL = "reader@example.test";

// the browser's jar, holding each value under its site and cookie name; WXT's fake browser has none
const jarHolds = (cookies: Readonly<Record<string, string>>): void => {
  fakeBrowser.cookies.get = async (
    details: Browser.cookies.CookieDetails,
  ): Promise<Browser.cookies.Cookie | null> => {
    const value = cookies[`${new URL(details.url).origin} ${details.name}`];
    return value === undefined
      ? null
      : {
          domain: new URL(details.url).hostname,
          hostOnly: true,
          httpOnly: true,
          name: details.name,
          path: "/",
          sameSite: "lax",
          secure: details.url.startsWith("https:"),
          session: false,
          storeId: "0",
          value,
        };
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
});

describe("the browser's sign-in, asked of the cloud", () => {
  it("sends the jar's session cookie as get-session's bearer, with the browser's credentials, and keeps the account it names", async () => {
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    const asked = cloudAnswers(async () => sessionOf(EMAIL));
    await expect(askedSignIn(SITE)).resolves.toStrictEqual({
      kind: "signed-in",
      session: { bearer: COOKIE, email: EMAIL, origin: SITE },
    });
    const [request] = asked;
    expect(request?.url).toBe(`${SITE}/api/auth/get-session`);
    expect(request?.headers.get("authorization")).toBe(`Bearer ${COOKIE}`);
    expect(request?.credentials).toBe("include");
    await expect(readConnection()).resolves.toStrictEqual({ email: EMAIL, origin: SITE });
  });

  it("reads the cookie Better Auth names on plain http, a local Worker's", async () => {
    jarHolds({
      [`${LOCAL} __Secure-better-auth.session_token`]: "the wrong one",
      [`${LOCAL} better-auth.session_token`]: COOKIE,
    });
    const asked = cloudAnswers(async () => sessionOf(EMAIL));
    await expect(askedSignIn(LOCAL)).resolves.toMatchObject({ kind: "signed-in" });
    expect(asked[0]?.headers.get("authorization")).toBe(`Bearer ${COOKIE}`);
  });

  it("is signed out, as the account last signed in, once the site signed out or the cloud ended the session", async () => {
    await keepConnection({ email: EMAIL, origin: SITE });
    jarHolds({});
    const asked = cloudAnswers(async () => sessionOf(EMAIL));
    await expect(askedSignIn(SITE)).resolves.toStrictEqual({ email: EMAIL, kind: "signed-out" });
    expect(asked).toStrictEqual([]);
    vi.restoreAllMocks();
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    cloudAnswers(async () => Response.json(null));
    await expect(askedSignIn(SITE)).resolves.toStrictEqual({ email: EMAIL, kind: "signed-out" });
    await expect(readConnection()).resolves.toStrictEqual({ email: EMAIL, origin: SITE });
  });

  it("names no account where none was ever signed in", async () => {
    jarHolds({});
    await expect(askedSignIn(SITE)).resolves.toStrictEqual({ kind: "none" });
  });

  it("says nothing of the session when the cloud did not answer, or answered a fault of its own", async () => {
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    cloudAnswers(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(askedSignIn(SITE)).resolves.toBeNull();
    vi.unstubAllGlobals();
    cloudAnswers(async () => new Response("down", { status: 503 }));
    await expect(askedSignIn(SITE)).resolves.toBeNull();
    await expect(readConnection()).resolves.toBeNull();
  });
});

describe("the sign-in a save goes under", () => {
  it("is the jar's cookie for the account last signed in, asked of nobody", async () => {
    await keepConnection({ email: EMAIL, origin: SITE });
    jarHolds({ [`${SITE} __Secure-better-auth.session_token`]: COOKIE });
    const asked = cloudAnswers(async () => sessionOf("someone-else@example.test"));
    await expect(saveSignIn()).resolves.toStrictEqual({
      kind: "signed-in",
      session: { bearer: COOKIE, email: EMAIL, origin: SITE },
    });
    expect(asked).toStrictEqual([]);
  });

  it("is signed out when the jar holds no cookie, as the site's sign-out leaves it", async () => {
    await keepConnection({ email: EMAIL, origin: SITE });
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
