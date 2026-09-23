import { describe, expect, it } from "vitest";
import {
  BROWSER_HANDOFF_TTL_MS,
  BROWSER_SESSION_COOKIE,
  createBrowserSession,
} from "../browser-session";

const cookieSecret = (setCookie: string | null): string => {
  const [pair = ""] = (setCookie ?? "").split(";");
  return pair.slice(`${BROWSER_SESSION_COOKIE}=`.length);
};

describe("the browser session", () => {
  it("trades a live nonce for the cookie exactly once", () => {
    const session = createBrowserSession();
    const nonce = session.mintHandoff();
    const cookie = session.redeemHandoff(nonce);
    expect(cookie).not.toBeNull();
    expect(session.cookieAccepted(cookieSecret(cookie))).toBe(true);
    expect(session.redeemHandoff(nonce)).toBeNull();
  });

  it("refuses a nonce it never minted, and one past its lifetime", () => {
    let now = 1_000_000;
    const session = createBrowserSession(() => now);
    expect(session.redeemHandoff("never-minted")).toBeNull();

    const stale = session.mintHandoff();
    now += BROWSER_HANDOFF_TTL_MS;
    expect(session.redeemHandoff(stale)).toBeNull();
  });

  it("sets a cookie script cannot read and a hostile page cannot send", () => {
    const session = createBrowserSession();
    const cookie = session.redeemHandoff(session.mintHandoff()) ?? "";
    expect(cookie.startsWith(`${BROWSER_SESSION_COOKIE}=`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    // never `Secure`: some browsers drop a Secure cookie on plain-http loopback rather than ignoring the attribute.
    expect(cookie).not.toContain("Secure");
  });

  it("holds one secret per boot, and a nonce is never it", () => {
    const first = createBrowserSession();
    const second = createBrowserSession();
    const nonce = first.mintHandoff();
    const secret = cookieSecret(first.redeemHandoff(nonce));
    expect(first.cookieAccepted(nonce)).toBe(false);
    expect(second.cookieAccepted(secret)).toBe(false);
    expect(first.cookieAccepted(`${secret}x`)).toBe(false);
  });
});
