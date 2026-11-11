import { describe, expect, it } from "vitest";
import { pagePolicy } from "./page-policy";

const directive = (policy: string, name: string): string | undefined =>
  policy
    .split("; ")
    .find((entry) => entry.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe("the note page's content policy", () => {
  it("opens one connection, the note's socket at the cloud's host", () => {
    expect(directive(pagePolicy("https://inteligir.com"), "connect-src")).toBe(
      "wss://inteligir.com",
    );
    expect(directive(pagePolicy("http://192.168.1.20:5174"), "connect-src")).toBe(
      "ws://192.168.1.20:5174",
    );
  });

  it("draws only its own scripts, and bytes the phone handed it", () => {
    const policy = pagePolicy("https://inteligir.com");

    expect(directive(policy, "default-src")).toBe("'self'");
    expect(directive(policy, "script-src")).toBe("'self'");
    expect(directive(policy, "img-src")).toBe("'self' data: blob:");
    expect(directive(policy, "media-src")).toBe("'self' blob:");
    expect(directive(policy, "object-src")).toBe("'none'");
    expect(directive(policy, "form-action")).toBe("'none'");
  });
});
