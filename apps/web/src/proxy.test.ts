import {
  getRedirectUrl,
  getRewrittenUrl,
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { nextConfig } from "../next.config";
import { SITE_POLICY } from "./lib/document-policy";
import { config, proxy } from "./proxy";

const ORIGIN = "http://localhost:5174";
const MARKDOWN = { accept: "text/markdown" };
const SIGNED_IN = { cookie: "better-auth.session_token=token.signature" };

const NONCE_DOCUMENTS = [
  "/library",
  "/library/settings",
  "/app/sign-in",
  "/app/sign-up",
  "/app/forgot-password",
  "/app/reset-password",
  "/connect/authorize",
];

const sees = (url: string, headers: Record<string, string> = {}) =>
  unstable_doesMiddlewareMatch({ config, headers, nextConfig, url });

const asked = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`${ORIGIN}${path}`, { headers }));

const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

const configured = async (path: string) =>
  await unstable_getResponseFromNextConfig({ nextConfig, url: `${ORIGIN}${path}` });

const policyAt = async (path: string) => {
  const response = await configured(path);

  return response.headers;
};

describe("which requests the proxy sees", () => {
  it.each(NONCE_DOCUMENTS)("%s, rendered per request", (path) => {
    expect(sees(path)).toBe(true);
  });

  it.each(["/", "/privacy", "/library/nope", "/app/nope", "/app"])(
    "not %s asked for as a page, which is prerendered or no page at all",
    (path) => {
      expect(sees(path)).toBe(false);
    },
  );

  it.each(["/", "/privacy", "/no-such-page"])("%s asked for as markdown", (path) => {
    expect(sees(path, MARKDOWN)).toBe(true);
  });

  it.each([
    "/api/health",
    "/v1/rpc/account/devices/list",
    "/connector",
    "/llms.txt",
    "/licenses.md",
    "/og.jpg",
    "/favicon/favicon.svg",
    "/_next/static/chunk.js",
  ])("not %s, which answers for itself, even asked for as markdown", (path) => {
    expect(sees(path, MARKDOWN)).toBe(false);
  });
});

describe("a signed-in page", () => {
  it("sends a visit with no session cookie to sign in and back", () => {
    const response = asked("/library/settings?from=mail");
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(
      `${ORIGIN}/app/sign-in?next=${encodeURIComponent("/library/settings?from=mail")}`,
    );
  });

  it("renders for a session cookie under this request's nonce", () => {
    const response = asked("/library", SIGNED_IN);
    const nonce = forwarded(response, "x-nonce") ?? "";
    expect(nonce).not.toBe("");
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(forwarded(response, "content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
  });
});

describe("an account page", () => {
  it("renders with no session under a nonce of its own each request", () => {
    const first = asked("/app/sign-in");
    const second = asked("/app/sign-in");
    expect(getRedirectUrl(first)).toBeNull();
    expect(forwarded(first, "x-nonce")).not.toBe(forwarded(second, "x-nonce"));
  });
});

describe("a page asked for as markdown", () => {
  it.each([
    ["/", "/api/markdown"],
    ["/privacy", "/api/markdown/privacy"],
  ])("%s answers from %s", (path, route) => {
    expect(getRewrittenUrl(asked(path, MARKDOWN))).toBe(`${ORIGIN}${route}`);
  });

  it("stays the page for a client that ranks HTML first", () => {
    const response = asked("/privacy", { accept: "text/html, text/markdown;q=0.5" });
    expect(getRewrittenUrl(response)).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept");
  });

  it("stays HTML on a document rendered per request", () => {
    expect(getRewrittenUrl(asked("/app/sign-in", MARKDOWN))).toBeNull();
  });
});

describe("the site's headers", () => {
  it("give a page the prerendered policy and keep it out of frames", async () => {
    const headers = await policyAt("/privacy");
    expect(headers.get("content-security-policy")).toBe(SITE_POLICY);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-robots-tag")).toBeNull();
  });

  it("leave a library file to set its own", async () => {
    const headers = await policyAt("/v1/blobs/abc");
    expect(headers.get("content-security-policy")).toBeNull();
    expect(headers.get("x-content-type-options")).toBeNull();
  });

  it.each(["/library", "/library/settings", "/app/reset-password"])(
    "keep %s out of search and its address from other sites",
    async (path) => {
      const headers = await policyAt(path);
      expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(headers.get("referrer-policy")).toBe("no-referrer");
    },
  );

  it("send bare /app on to the library", async () => {
    const response = await configured("/app");
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(`${ORIGIN}/library`);
  });
});
