import { describe, expect, it } from "vitest";
import { isSameOriginBrowserRequest } from "../browser-request";

describe("isSameOriginBrowserRequest", () => {
  it("allows the SPA's own fetch/ws (Sec-Fetch-Site: same-origin)", () => {
    expect(
      isSameOriginBrowserRequest({
        host: "127.0.0.1:4664",
        origin: "http://127.0.0.1:4664",
        secFetchSite: "same-origin",
      }),
    ).toBe(true);
  });

  it("allows a user-typed navigation (Sec-Fetch-Site: none)", () => {
    expect(
      isSameOriginBrowserRequest({
        host: "127.0.0.1:4664",
        origin: undefined,
        secFetchSite: "none",
      }),
    ).toBe(true);
  });

  it("REFUSES a co-resident page on another loopback port (same-site, not same-origin)", () => {
    // The whole point: a different port is same-SITE on loopback, so the cookie
    // rides along — Sec-Fetch-Site is what tells that apart from same-origin.
    expect(
      isSameOriginBrowserRequest({
        host: "127.0.0.1:4664",
        origin: "http://127.0.0.1:9999",
        secFetchSite: "same-site",
      }),
    ).toBe(false);
  });

  it("REFUSES a cross-site page", () => {
    expect(
      isSameOriginBrowserRequest({
        host: "127.0.0.1:4664",
        origin: "http://evil.example",
        secFetchSite: "cross-site",
      }),
    ).toBe(false);
  });

  it("falls back to an Origin match when Sec-Fetch-Site is absent", () => {
    expect(
      isSameOriginBrowserRequest({
        host: "127.0.0.1:4664",
        origin: "http://127.0.0.1:4664",
        secFetchSite: undefined,
      }),
    ).toBe(true);
    expect(
      isSameOriginBrowserRequest({
        host: "127.0.0.1:4664",
        origin: "http://127.0.0.1:9999",
        secFetchSite: undefined,
      }),
    ).toBe(false);
  });

  it("refuses when it can prove neither same-origin nor a matching Origin", () => {
    expect(
      isSameOriginBrowserRequest({
        host: "127.0.0.1:4664",
        origin: undefined,
        secFetchSite: undefined,
      }),
    ).toBe(false);
  });
});
