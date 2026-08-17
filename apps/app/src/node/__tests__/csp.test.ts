// The policy is applied to the shell being served, so the test that matters is
// over the shell this repo actually builds — a hand-written fixture would pass
// while production shipped a blocked script. (The end-to-end proof is
// `pnpm e2e --prod`, which renders the real page in a real browser; these pin
// the pieces so a failure names itself.)

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  prepareShellTemplate,
  renderShell,
  SHELL_NONCE_PLACEHOLDER,
} from "../csp";

const BUILT_SHELL = join(import.meta.dirname, "..", "..", "..", "dist", "client", "_shell.html");

function directive(policy: string, name: string): string {
  const found = policy.split("; ").find((entry) => entry.startsWith(`${name} `));
  if (found === undefined) {
    throw new Error(`no ${name} directive in ${policy}`);
  }
  return found;
}

describe("prepareShellTemplate / renderShell", () => {
  it("nonces every script tag, inline and sourced alike", () => {
    const template = prepareShellTemplate(
      '<script>a</script><script type="module" src="/x.js"></script>',
    );
    const html = renderShell(template, "N0NCE");
    expect(html).toBe(
      '<script nonce="N0NCE">a</script><script nonce="N0NCE" type="module" src="/x.js"></script>',
    );
  });

  it("leaves nothing behind when a nonce is substituted", () => {
    const html = renderShell(prepareShellTemplate("<script>a</script>"), "N0NCE");
    expect(html).not.toContain(SHELL_NONCE_PLACEHOLDER);
  });

  it("uses a placeholder no browser would accept as a real nonce", () => {
    // A template that escaped un-rendered must be refused, not quietly trusted.
    expect(SHELL_NONCE_PLACEHOLDER).not.toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
  });

  it("touches nothing else in the document", () => {
    const html = "<head><title>t</title></head><body><div id=a></div></body>";
    expect(renderShell(prepareShellTemplate(html), "N")).toBe(html);
  });
});

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

describe("over the BUILT shell", () => {
  it.runIf(existsSync(BUILT_SHELL))("nonces every script the production shell carries", () => {
    const html = readFileSync(BUILT_SHELL, "utf8");
    const scriptTags = html.match(/<script/gu) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    const rendered = renderShell(prepareShellTemplate(html), "N0NCE");
    expect(rendered.match(/<script nonce="N0NCE"/gu)).toHaveLength(scriptTags.length);
  });
});
