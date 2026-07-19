import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vault-app-protocol.ts imports `electron` at module scope (protocol.*). Stub
// it — the tests drive the pure resolver, not Electron's dispatch.
vi.mock("electron", () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));

import { VaultManager } from "@repo/vault/vault";

import { injectHtmlAppRuntime } from "@/html-app-inject";
import {
  isValidToken,
  mintHtmlAppToken,
  resolveVaultAppRequest,
  revokeHtmlAppToken,
  type VaultAppDeps,
} from "@/main/vault-app-protocol";

let tmp: string;
let root: string;
let vault: VaultManager;

const TOKEN = "test-token-0123456789";

function deps(over: Partial<VaultAppDeps> = {}): VaultAppDeps {
  return {
    readBytes: (rel) => vault.readBytes(rel),
    isValidToken: (t) => t === TOKEN,
    ...over,
  };
}

function url(pathAndQuery: string): string {
  return `vault-app://app/${pathAndQuery}`;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-app-test-"));
  root = path.join(tmp, "vault");
  vault = new VaultManager({
    settingsPath: path.join(tmp, "settings.json"),
    defaultRoot: root,
    manageAgentLink: false,
  });
  vault.writeText("app.html", "<html><head></head><body><h1>hi</h1></body></html>");
  vault.writeText("data.json", '{"n":1}');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("resolveVaultAppRequest — token", () => {
  it("rejects a missing token with 403", () => {
    const result = resolveVaultAppRequest(url("app.html"), deps());
    expect(result).toEqual({ kind: "error", status: 403, message: "forbidden" });
  });

  it("rejects an unminted / wrong token with 403", () => {
    const result = resolveVaultAppRequest(url(`app.html?token=nope`), deps());
    expect(result).toEqual({ kind: "error", status: 403, message: "forbidden" });
  });

  it("serves a valid token", () => {
    const result = resolveVaultAppRequest(url(`app.html?token=${TOKEN}`), deps());
    expect(result.kind).toBe("ok");
  });
});

describe("resolveVaultAppRequest — confinement (real VaultManager.resolve)", () => {
  const badPaths = ["../secret.md", "..%2F..%2Fetc%2Fpasswd", "%2Fetc%2Fpasswd"];
  for (const bad of badPaths) {
    it(`rejects escaping path ${bad} with 404`, () => {
      const result = resolveVaultAppRequest(url(`${bad}?token=${TOKEN}`), deps());
      expect(result).toEqual({ kind: "error", status: 404, message: "not found" });
    });
  }

  it("rejects a symlink that points outside the vault with 404", () => {
    const outside = path.join(tmp, "outside.txt");
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(root, "link.txt"));
    const result = resolveVaultAppRequest(url(`link.txt?token=${TOKEN}`), deps());
    expect(result).toEqual({ kind: "error", status: 404, message: "not found" });
  });

  it("rejects a non-`app` authority with 404", () => {
    const result = resolveVaultAppRequest(`vault-app://runtime/app.html?token=${TOKEN}`, deps());
    expect(result).toEqual({ kind: "error", status: 404, message: "not found" });
  });

  it("404s a file that does not exist", () => {
    const result = resolveVaultAppRequest(url(`missing.html?token=${TOKEN}`), deps());
    expect(result).toEqual({ kind: "error", status: 404, message: "not found" });
  });
});

describe("resolveVaultAppRequest — serving", () => {
  it("injects the runtime into an html response", () => {
    const result = resolveVaultAppRequest(url(`app.html?token=${TOKEN}`), deps());
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.contentType).toBe("text/html; charset=utf-8");
    const html = new TextDecoder().decode(result.body);
    expect(html).toContain("data-inteligir-injected");
    expect(html).toContain("window.inteligir");
  });

  it("serves a non-html asset raw with its content type", () => {
    const result = resolveVaultAppRequest(url(`data.json?token=${TOKEN}`), deps());
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.contentType).toBe("application/json; charset=utf-8");
    expect(new TextDecoder().decode(result.body)).toBe('{"n":1}');
  });
});

describe("injectHtmlAppRuntime", () => {
  it("tags every injected node and issues NO runtime network fetch", () => {
    const out = injectHtmlAppRuntime("<html><head></head><body></body></html>");
    expect(out).toContain("data-inteligir-injected");
    // Deps are inlined — nothing loads from a remote origin. (The vendored
    // bundles contain http URLs in comments; the real property is that no
    // element FETCHES one: no external script/style src/href, no <link>.)
    expect(out).not.toMatch(/\b(?:src|href)\s*=\s*["']https?:/i);
    expect(out).not.toMatch(/<link\b/i);
    expect(out).not.toMatch(/@import\s+(?:url\()?["']?https?:/i);
  });

  it("injects runtime + tailwind in head and alpine before </body>", () => {
    const out = injectHtmlAppRuntime("<html><head></head><body>APP</body></html>");
    expect(out.indexOf("window.inteligir")).toBeLessThan(out.indexOf("</head>"));
    expect(out.indexOf("APP")).toBeLessThan(out.lastIndexOf("</body>"));
  });

  it("still injects when head/body tags are absent", () => {
    const out = injectHtmlAppRuntime("<div>fragment</div>");
    expect(out).toContain("data-inteligir-injected");
    expect(out).toContain("window.inteligir");
  });
});

describe("mintHtmlAppToken", () => {
  it("mints distinct tokens", () => {
    expect(mintHtmlAppToken()).not.toBe(mintHtmlAppToken());
  });
});

describe("revokeHtmlAppToken", () => {
  it("a revoked token 403s against the real protocol store", () => {
    const token = mintHtmlAppToken();
    // Valid before revocation — drives the real module-level store, not a fake.
    expect(
      resolveVaultAppRequest(url(`app.html?token=${token}`), deps({ isValidToken })).kind,
    ).toBe("ok");

    revokeHtmlAppToken(token);

    expect(resolveVaultAppRequest(url(`app.html?token=${token}`), deps({ isValidToken }))).toEqual({
      kind: "error",
      status: 403,
      message: "forbidden",
    });
  });

  it("is a no-op for a token that was never minted", () => {
    expect(() => revokeHtmlAppToken("never-minted")).not.toThrow();
  });
});
