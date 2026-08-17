// The policy STRING only. What the document actually carries is asserted where
// a fresh build is guaranteed: `app.test.ts` holds the served nonce against the
// policy that names it, and `pnpm e2e --prod`'s browser-smoke reads the real
// built document. Nothing here may read `dist/` — `pnpm verify` runs the tests
// BEFORE the build, so such a test asserts over the PREVIOUS build's output
// and either skips on a clean checkout or fails on a stale one.

import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "../csp";

function directive(policy: string, name: string): string {
  const found = policy.split("; ").find((entry) => entry.startsWith(`${name} `));
  if (found === undefined) {
    throw new Error(`no ${name} directive in ${policy}`);
  }
  return found;
}

describe("buildContentSecurityPolicy", () => {
  const policy = buildContentSecurityPolicy({ nonce: "N0NCE", wsOrigin: "ws://127.0.0.1:4664" });

  it("admits scripts by NONCE and strict-dynamic, never by 'self' or inline", () => {
    // 'self' would admit any same-origin path an injection can reach;
    // 'unsafe-inline' would admit the injection itself.
    expect(directive(policy, "script-src")).toBe("script-src 'nonce-N0NCE' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(directive(policy, "script-src")).not.toContain("unsafe-inline");
  });

  it("names the websocket origin explicitly beside 'self'", () => {
    // This is the directive that matters most here: an injected script that
    // cannot reach a third-party origin cannot exfiltrate the vault.
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' ws://127.0.0.1:4664");
  });

  it("forbids objects, framing and workers, and pins base-uri and form-action", () => {
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it("keeps style-src open, which is the stated residual", () => {
    // CodeMirror injects its theme as a runtime <style>; nothing here can
    // nonce that. Pinned so the weakness stays deliberate.
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });
});
