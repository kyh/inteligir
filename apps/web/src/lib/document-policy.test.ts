import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { noFlashThemeScript } from "#library/no-flash-theme";

import { libraryPolicy, mintNonce, SITE_POLICY } from "./document-policy";

const SITE = new URL("https://www.inteligir.com/library");

const directiveOf = (policy: string, name: string) =>
  policy.split("; ").find((directive) => directive.startsWith(`${name} `));

const THEME_HASH = `'sha256-${createHash("sha256").update(noFlashThemeScript).digest("base64")}'`;

describe("the policy of a document rendered per request", () => {
  it("runs this request's nonce and the theme script alone inline", () => {
    expect(directiveOf(libraryPolicy(SITE, "abc"), "script-src")).toBe(
      `script-src 'self' 'nonce-abc' ${THEME_HASH}`,
    );
  });

  it("runs a worker only from the site's own scripts, as an import reads its file", () => {
    expect(directiveOf(libraryPolicy(SITE, "n"), "worker-src")).toBe("worker-src 'self'");
  });

  it("frames the library's own files on this origin, and nothing else", () => {
    expect(directiveOf(libraryPolicy(SITE, "n"), "frame-src")).toBe(
      "frame-src https://www.inteligir.com/v1/blobs/",
    );
    expect(
      directiveOf(libraryPolicy(new URL("http://localhost:5174/library"), "n"), "frame-src"),
    ).toBe("frame-src http://localhost:5174/v1/blobs/");
  });

  it("calls this origin, the file store's uploads and the Mac app's command channel alone", () => {
    expect(directiveOf(libraryPolicy(SITE, "n"), "connect-src")).toBe(
      "connect-src 'self' https://vercel.com/api/blob/ ipc:",
    );
    expect(
      directiveOf(libraryPolicy(new URL("http://localhost:5174/library"), "n"), "connect-src"),
    ).toBe("connect-src 'self' https://vercel.com/api/blob/ ipc:");
  });

  it("mints a fresh nonce each request", () => {
    expect(mintNonce()).not.toBe(mintNonce());
    expect(atob(mintNonce())).toHaveLength(16);
  });
});

describe("the policy of a prerendered page", () => {
  it("runs its inline scripts, which a page built once cannot nonce", () => {
    expect(directiveOf(SITE_POLICY, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
  });

  it("embeds nothing, and calls this origin, the file store's uploads and the Mac app's command channel alone", () => {
    expect(directiveOf(SITE_POLICY, "object-src")).toBe("object-src 'none'");
    expect(directiveOf(SITE_POLICY, "connect-src")).toBe(
      "connect-src 'self' https://vercel.com/api/blob/ ipc:",
    );
  });
});

describe("both policies", () => {
  it.each([
    ["per request", libraryPolicy(SITE, "n")],
    ["prerendered", SITE_POLICY],
  ])(
    "%s, draw an item from this origin and the bytes the page holds, and are never framed",
    (_document, policy) => {
      expect(directiveOf(policy, "default-src")).toBe("default-src 'self'");
      expect(directiveOf(policy, "img-src")).toBe("img-src 'self' data: blob:");
      expect(directiveOf(policy, "media-src")).toBe("media-src 'self' blob:");
      expect(directiveOf(policy, "font-src")).toBe("font-src 'self' data:");
      expect(directiveOf(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
      expect(directiveOf(policy, "script-src")).not.toContain("'unsafe-eval'");
    },
  );
});
