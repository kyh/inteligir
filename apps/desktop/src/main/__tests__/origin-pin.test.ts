// The origin pin is the shell's entire security surface, so it is tested as a
// matrix rather than by example: what a hostile link inside a note can be, and
// what each shape is allowed to do.

import { describe, expect, it } from "vitest";
import {
  classifyNavigation,
  classifyWindowOpen,
  isHttpUrl,
  isSameOriginNavigation,
} from "../origin-pin";

const ORIGIN = "http://127.0.0.1:4664";

describe("isSameOriginNavigation", () => {
  it.each([
    ["http://127.0.0.1:4664/", true],
    ["http://127.0.0.1:4664/app/notes/a.md?x=1#y", true],
    // A prefix compare would call every one of these same-origin.
    ["http://127.0.0.1:46640/", false],
    ["http://127.0.0.1:4664.evil.com/", false],
    ["https://127.0.0.1:4664/", false],
    // localhost and 127.0.0.1 are DIFFERENT origins to a browser.
    ["http://localhost:4664/", false],
    ["http://[::1]:4664/", false],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["about:blank", false],
    ["not a url", false],
    ["", false],
  ])("%s → %s", (target, expected) => {
    expect(isSameOriginNavigation(target, ORIGIN)).toBe(expected);
  });

  it("fails closed when the shell has no origin", () => {
    expect(isSameOriginNavigation("http://127.0.0.1:4664/", "")).toBe(false);
  });
});

describe("classifyNavigation", () => {
  it("allows the pinned origin", () => {
    expect(classifyNavigation(`${ORIGIN}/app`, ORIGIN)).toBe("allow");
  });

  it.each([
    "https://inteligir.com/",
    "http://evil.example/phish",
    "http://127.0.0.1:4665/",
    "http://localhost:4664/",
  ])("hands %s to the system browser instead of the window", (target) => {
    expect(classifyNavigation(target, ORIGIN)).toBe("block-and-open-external");
  });

  it.each([
    "file:///Users/kyh/.ssh/id_rsa",
    "javascript:fetch('/api/v1/vault/file')",
    "data:text/html,<h1>hi",
    "inteligir://open",
    "about:blank",
    "https://",
    "  ",
  ])("blocks %s outright — never handed to the system browser either", (target) => {
    expect(classifyNavigation(target, ORIGIN)).toBe("block");
  });

  it("blocks everything, including the origin, when the shell has no origin", () => {
    expect(classifyNavigation(`${ORIGIN}/app`, "")).toBe("block-and-open-external");
  });
});

describe("classifyWindowOpen", () => {
  it("denies a popup at its own origin — the shell grants no second window", () => {
    // The verdict never says "allow"; the type has no such member.
    expect(classifyWindowOpen(`${ORIGIN}/app`)).toBe("deny-and-open-external");
  });

  it("denies a cross-origin popup, offering the system browser", () => {
    expect(classifyWindowOpen("https://example.com/")).toBe("deny-and-open-external");
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "about:blank", "chrome://settings", ""])(
    "denies %s with no external hand-off",
    (url) => {
      expect(classifyWindowOpen(url)).toBe("deny");
    },
  );
});

describe("isHttpUrl", () => {
  it.each([
    ["http://a/", true],
    ["https://a/", true],
    ["ftp://a/", false],
    ["file:///a", false],
    ["javascript:1", false],
    ["", false],
  ])("%s → %s", (value, expected) => {
    expect(isHttpUrl(value)).toBe(expected);
  });
});
