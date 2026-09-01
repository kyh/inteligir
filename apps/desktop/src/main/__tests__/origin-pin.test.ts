// The origin pin is the shell's entire security surface, so it is tested as a
// matrix rather than by example: what a hostile link inside a note can be, and
// what each shape is allowed to do.

import { describe, expect, it } from "vitest";
import {
  ALLOWED_PERMISSIONS,
  appWindowWebPreferences,
  classifyNavigation,
  classifyPermission,
  classifyWindowOpen,
  decideExternalOpen,
  isHttpUrl,
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

// The SHIPPED window is pinned to `inteligir://app`, so the
// custom-scheme arm of `comparableOrigin` — the `URL.origin === "null"` trap the
// header spends its length on, plus the username and empty-hostname refusals —
// is the PRODUCTION path. The matrix above pins an http origin (the in-app
// browser's), which never exercises it; this block drives the real pin.
describe("the pinned custom scheme (inteligir://app)", () => {
  const APP = "inteligir://app";

  it.each([
    ["inteligir://app", true],
    ["inteligir://app/", true],
    ["inteligir://app/notes/a.md?x=1#y", true],
    // The `URL.origin === "null"` trap: a naive origin compare calls these two
    // equal, collapsing the pin to nothing.
    ["inteligir://evil/", false],
    ["inteligir://evil", false],
    // `inteligir://app@evil/` parses to username "app", hostname "evil".
    ["inteligir://app@evil/x", false],
    // Empty authority.
    ["inteligir:///x", false],
    // Cross-scheme: the loopback server is a DIFFERENT origin to the window.
    ["http://127.0.0.1:4664/", false],
    ["inteligir2://app/", false],
  ])("isSameOriginNavigation %s → %s", (target, expected) => {
    expect(isSameOriginNavigation(target, APP)).toBe(expected);
  });

  it("classifyNavigation allows the pin and blocks the impostors", () => {
    expect(classifyNavigation("inteligir://app/notes", APP)).toBe("allow");
    // A custom scheme is never handed to the system browser — it is not http.
    expect(classifyNavigation("inteligir://app@evil/x", APP)).toBe("block");
    expect(classifyNavigation("inteligir://evil/x", APP)).toBe("block");
    // The loopback origin is real http, so it goes to the browser rather than
    // being swallowed.
    expect(classifyNavigation("http://127.0.0.1:4664/", APP)).toBe("block-and-open-external");
  });

  it("grants media only to the pinned origin, in both carriers Chromium delivers", () => {
    // The check handler passes a bare origin; the request handler passes a full
    // requestingUrl. A standard-registered scheme gets a real origin from
    // Chromium, so both forms must resolve the same.
    expect(classifyPermission("media", APP, APP)).toBe(true);
    expect(classifyPermission("media", "inteligir://app/note", APP)).toBe(true);
    expect(classifyPermission("media", "inteligir://evil", APP)).toBe(false);
    expect(classifyPermission("media", "inteligir://app@evil/x", APP)).toBe(false);
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

describe("classifyPermission", () => {
  it("grants exactly one permission — the dictation microphone", () => {
    // The origin pin is the whole security surface, so the set that can EVER
    // be granted is asserted here rather than left to the matrix below.
    expect(ALLOWED_PERMISSIONS).toEqual(["media"]);
  });

  it("grants media to the window's own origin", () => {
    expect(classifyPermission("media", ORIGIN, ORIGIN)).toBe(true);
    // The request handler passes a full URL as the requesting origin; the
    // check handler passes a bare origin. Both must resolve the same.
    expect(classifyPermission("media", `${ORIGIN}/app/note`, ORIGIN)).toBe(true);
  });

  it.each([
    "http://127.0.0.1:46640",
    "http://127.0.0.1:4665",
    "https://evil.example.com",
    "http://localhost:4664",
    "",
  ])("denies media to a different origin (%s)", (requestingOrigin) => {
    expect(classifyPermission("media", requestingOrigin, ORIGIN)).toBe(false);
  });

  it("denies media when the shell has no origin of its own", () => {
    expect(classifyPermission("media", ORIGIN, "")).toBe(false);
  });

  it.each([
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
  ])("denies %s even from the window's own origin", (permission) => {
    expect(classifyPermission(permission, ORIGIN, ORIGIN)).toBe(false);
  });
});

describe("appWindowWebPreferences", () => {
  it("isolates the app window, and takes the vault's partition rather than the default session", () => {
    // Every flag, by value: these are Electron's defaults today, so a silent
    // flip is exactly the change nothing else in this process would notice.
    expect(appWindowWebPreferences("/x/preload.cjs", "persist:vault-1")).toEqual({
      preload: "/x/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: "persist:vault-1",
    });
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
