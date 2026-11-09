import { describe, expect, it } from "vitest";

import { mintNonce, pagePolicy, withPagePolicy } from "./document-policy";

const SITE = new URL("https://inteligir.com/library");

const html = (headers: Record<string, string> = {}) =>
  new Response("<!doctype html><p>hi</p>", {
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });

describe("the page's policy", () => {
  it("names this request's nonce for inline scripts, and no other inline script", () => {
    const policy = pagePolicy(SITE, "abc");
    const scripts = policy.split("; ").find((directive) => directive.startsWith("script-src"));
    expect(scripts).toBe("script-src 'self' 'nonce-abc'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("calls this origin, its socket and the Mac app's command channel alone", () => {
    expect(pagePolicy(SITE, "n")).toContain("connect-src 'self' wss://inteligir.com ipc:;");
    expect(pagePolicy(new URL("http://localhost:5174/library"), "n")).toContain(
      "connect-src 'self' ws://localhost:5174 ipc:;",
    );
  });

  it("mints a fresh nonce each request", () => {
    expect(mintNonce()).not.toBe(mintNonce());
    expect(atob(mintNonce())).toHaveLength(16);
  });
});

describe("a response under the page's policy", () => {
  it("puts the policy on a document that names none", async () => {
    const answered = withPagePolicy(html(), SITE, "n1");
    expect(answered.headers.get("content-security-policy")).toBe(pagePolicy(SITE, "n1"));
    await expect(answered.text()).resolves.toBe("<!doctype html><p>hi</p>");
  });

  it("leaves a text/html file its own sandbox", () => {
    const blob = html({ "content-security-policy": "default-src 'none'; sandbox" });
    const answered = withPagePolicy(blob, SITE, "n1");
    expect(answered.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("leaves an answer that is no document as it is", () => {
    const json = Response.json({ ok: true });
    expect(withPagePolicy(json, SITE, "n1")).toBe(json);
    expect(json.headers.has("content-security-policy")).toBe(false);
  });
});
