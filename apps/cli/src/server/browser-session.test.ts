import { describe, expect, it } from "vitest";
import { BROWSER_HANDOFF_TTL_MS, createBrowserSession } from "./browser-session";

describe("the browser session", () => {
  it("trades a live nonce for the cookie's secret exactly once", () => {
    const session = createBrowserSession();
    const nonce = session.mintHandoff();
    const secret = session.redeemHandoff(nonce);
    expect(secret).not.toBeNull();
    expect(session.cookieAccepted(secret ?? "")).toBe(true);
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

  it("holds one secret per boot, and a nonce is never it", () => {
    const first = createBrowserSession();
    const second = createBrowserSession();
    const nonce = first.mintHandoff();
    const secret = first.redeemHandoff(nonce) ?? "";
    expect(first.cookieAccepted(nonce)).toBe(false);
    expect(second.cookieAccepted(secret)).toBe(false);
    expect(first.cookieAccepted(`${secret}x`)).toBe(false);
  });
});
