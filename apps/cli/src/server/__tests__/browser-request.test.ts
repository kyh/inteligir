import { describe, expect, it } from "vitest";
import { isSameOriginBrowserRequest } from "../browser-request";

describe("isSameOriginBrowserRequest", () => {
  it("allows the SPA's own fetch/ws (Sec-Fetch-Site: same-origin)", () => {
    expect(
      isSameOriginBrowserRequest({
        secFetchSite: "same-origin",
        origin: "http://127.0.0.1:4664",
        host: "127.0.0.1:4664",
      }),
    ).toBe(true);
  });

  it("allows a user-typed navigation (Sec-Fetch-Site: none)", () => {
    expect(
      isSameOriginBrowserRequest({
        secFetchSite: "none",
        origin: undefined,
        host: "127.0.0.1:4664",
      }),
    ).toBe(true);
  });

  it("REFUSES a co-resident page on another loopback port (same-site, not same-origin)", () => {
    // The whole point: a different port is same-SITE on loopback, so the cookie
    // rides along — Sec-Fetch-Site is what tells that apart from same-origin.
    expect(
      isSameOriginBrowserRequest({
        secFetchSite: "same-site",
        origin: "http://127.0.0.1:9999",
        host: "127.0.0.1:4664",
      }),
    ).toBe(false);
  });

  it("REFUSES a cross-site page", () => {
    expect(
      isSameOriginBrowserRequest({
        secFetchSite: "cross-site",
        origin: "http://evil.example",
        host: "127.0.0.1:4664",
      }),
    ).toBe(false);
  });

  it("falls back to an Origin match when Sec-Fetch-Site is absent", () => {
    expect(
      isSameOriginBrowserRequest({
        secFetchSite: undefined,
        origin: "http://127.0.0.1:4664",
        host: "127.0.0.1:4664",
      }),
    ).toBe(true);
    expect(
      isSameOriginBrowserRequest({
        secFetchSite: undefined,
        origin: "http://127.0.0.1:9999",
        host: "127.0.0.1:4664",
      }),
    ).toBe(false);
  });

  it("refuses when it can prove neither same-origin nor a matching Origin", () => {
    expect(
      isSameOriginBrowserRequest({
        secFetchSite: undefined,
        origin: undefined,
        host: "127.0.0.1:4664",
      }),
    ).toBe(false);
  });
});
