import { describe, expect, it } from "vitest";
import { PAGE_POLICY } from "./page-policy";

const directive = (name: string) =>
  PAGE_POLICY.split("; ")
    .find((entry) => entry.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe("the note page's content policy", () => {
  it("opens no connection, since native's actions are the page's only way to the library", () => {
    expect(directive("connect-src")).toBe("'none'");
    expect(directive("worker-src")).toBe("'none'");
  });

  it("draws only its own scripts, and bytes the phone handed it", () => {
    expect(directive("default-src")).toBe("'self'");
    expect(directive("script-src")).toBe("'self'");
    expect(directive("img-src")).toBe("'self' data: blob:");
    expect(directive("media-src")).toBe("'self' blob:");
    expect(directive("font-src")).toBe("'self' data:");
    expect(directive("frame-src")).toBe("'self'");
    expect(directive("object-src")).toBe("'none'");
    expect(directive("form-action")).toBe("'none'");
  });
});
