// The origin pin is the shell's entire security surface, so it is tested as a
// matrix rather than by example: what a hostile link inside a note can be, and
// what each shape is allowed to do.

import { describe, expect, it } from "vitest";
import {
  ALLOWED_PERMISSIONS,
  classifyNavigation,
  classifyWindowOpen,
  decideExternalOpen,
  isHttpUrl,
  isPermissionAllowed,
  isSameOriginNavigation,
  USER_ACTIVATION_WINDOW_MS,
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

describe("decideExternalOpen", () => {
  const NOW = 1_000_000;

  it("opens an http(s) URL while a gesture is still recent", () => {
    expect(
      decideExternalOpen({ url: "https://example.com/", lastInputAt: NOW - 100, now: NOW }),
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("refuses a URL the page produced with no user activation at all", () => {
    // A script loop calling window.open would otherwise become a loop of OS
    // browser launches, every one outside the origin pin.
    expect(
      decideExternalOpen({ url: "https://example.com/", lastInputAt: null, now: NOW }),
    ).toEqual({
      allowed: false,
      reason: "no-user-activation",
    });
  });

  it("refuses once the activation window has passed", () => {
    expect(
      decideExternalOpen({
        url: "https://example.com/",
        lastInputAt: NOW - USER_ACTIVATION_WINDOW_MS - 1,
        now: NOW,
      }),
    ).toEqual({ allowed: false, reason: "no-user-activation" });
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "inteligir://open", "data:text/html,x"])(
    "refuses %s however recent the gesture was",
    (url) => {
      expect(decideExternalOpen({ url, lastInputAt: NOW, now: NOW })).toEqual({
        allowed: false,
        reason: "not-http",
      });
    },
  );

  it("checks the scheme BEFORE the gesture, so the reason names the real problem", () => {
    expect(decideExternalOpen({ url: "file:///x", lastInputAt: null, now: NOW }).reason).toBe(
      "not-http",
    );
  });
});

describe("isPermissionAllowed", () => {
  it("grants nothing — the product uses no web permission", () => {
    // Electron's default is to GRANT most of these to whatever a window loads,
    // so the empty list is the policy, not an oversight.
    expect(ALLOWED_PERMISSIONS).toEqual([]);
  });

  it.each([
    "media",
    "geolocation",
    "notifications",
    "midi",
    "midiSysex",
    "clipboard-read",
    "display-capture",
    "openExternal",
    "pointerLock",
    "fullscreen",
    "idle-detection",
    "serial",
    "hid",
    "usb",
  ])("denies %s", (permission) => {
    expect(isPermissionAllowed(permission)).toBe(false);
  });
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
