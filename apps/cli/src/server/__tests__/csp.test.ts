// never read `dist/` here: `pnpm verify` runs tests before the build, so it would assert over the previous build.

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
  const policy = buildContentSecurityPolicy({ wsOrigin: "ws://127.0.0.1:4664" });

  it("admits the built shell's own script and nothing inline", () => {
    expect(directive(policy, "script-src")).toBe("script-src 'self'");
    expect(policy).not.toContain("unsafe-eval");
    expect(directive(policy, "script-src")).not.toContain("unsafe-inline");
  });

  it("names the websocket origin explicitly beside 'self'", () => {
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' ws://127.0.0.1:4664");
  });

  it("forbids objects, framing and workers, and pins base-uri and form-action", () => {
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    // 'self' rather than 'none' for one frame: inteligir-html's sandboxed srcdoc preview.
    expect(policy).toContain("frame-src 'self'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it("keeps style-src open, which is the stated residual", () => {
    // react style attributes and lowlight's runtime <style> injection cannot be nonced.
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("names no remote image host, so a note cannot phone one on open", () => {
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: blob:");
  });
});
