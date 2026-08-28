// The browser panel's policy, tested as a matrix like the origin pin: what a
// URL bar entry, a page navigation and a popup can be, and what each shape is
// allowed to do — plus the webPreferences flags pinned as data, because the
// difference between "preload on the chrome bar" and "preload on the content
// view" is the difference between a nav bar and an XSS-to-shell bridge.

import { describe, expect, it } from "vitest";
import {
  BROWSER_PARTITION,
  CAPTURE_SELECTION_MAX_CHARS,
  capturePageMessage,
  capturePageTitle,
  chromeViewWebPreferences,
  classifyBrowserNavigation,
  classifyBrowserWindowOpen,
  contentViewWebPreferences,
  resolveAddressInput,
} from "../browser-panel";

describe("resolveAddressInput", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://example.com", "http://example.com"],
    ["  https://example.com  ", "https://example.com"],
    ["example.com", "https://example.com"],
    ["news.ycombinator.com/item?id=1", "https://news.ycombinator.com/item?id=1"],
  ])("%s → %s", (input, resolved) => {
    expect(resolveAddressInput(input)).toBe(resolved);
  });

  it("refuses to become a non-http launcher — never file:, javascript:, or a scheme", () => {
    for (const hostile of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "chrome://settings",
      "about:blank",
      "data:text/html,<script>1</script>",
    ]) {
      const resolved = resolveAddressInput(hostile);
      // Either refused outright or resolved to an http(s) search — never the
      // hostile scheme itself.
      if (resolved !== null) {
        expect(resolved.startsWith("https://")).toBe(true);
        expect(new URL(resolved).protocol).toBe("https:");
      }
    }
  });

  it("words search instead of navigating", () => {
    expect(resolveAddressInput("how do wikis work")).toBe(
      "https://duckduckgo.com/?q=how%20do%20wikis%20work",
    );
  });

  it("empty input is null", () => {
    expect(resolveAddressInput("   ")).toBeNull();
  });
});

describe("classifyBrowserNavigation", () => {
  it.each([
    ["https://example.com/", "allow"],
    ["http://example.com/", "allow"],
    ["file:///etc/passwd", "block"],
    ["javascript:alert(1)", "block"],
    ["blob:https://example.com/x", "block"],
    ["not a url", "block"],
  ])("%s → %s", (url, verdict) => {
    expect(classifyBrowserNavigation(url)).toBe(verdict);
  });
});

describe("classifyBrowserWindowOpen", () => {
  it("popups are always denied; http targets navigate in place", () => {
    expect(classifyBrowserWindowOpen("https://example.com/")).toBe("deny-and-navigate");
    expect(classifyBrowserWindowOpen("javascript:alert(1)")).toBe("deny");
    expect(classifyBrowserWindowOpen("file:///x")).toBe("deny");
  });
});

describe("webPreferences", () => {
  it("the content view has NO preload, no node, its own partition, sandboxed", () => {
    const prefs = contentViewWebPreferences();
    expect(prefs).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: BROWSER_PARTITION,
    });
    expect("preload" in prefs).toBe(false);
  });

  it("the chrome bar carries the browser window's preload and no partition of its own", () => {
    const prefs = chromeViewWebPreferences("/x/browser-preload.cjs");
    expect(prefs).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: "/x/browser-preload.cjs",
    });
  });

  it("the browser partition is persistent and NOT the app's", () => {
    expect(BROWSER_PARTITION.startsWith("persist:")).toBe(true);
    expect(BROWSER_PARTITION).toContain("browser");
  });
});

describe("page capture", () => {
  it("titles from the page, falling back to the url", () => {
    expect(capturePageTitle({ url: "https://x.dev/", title: "A Page", selection: "" })).toBe(
      "Page: A Page",
    );
    expect(capturePageTitle({ url: "https://x.dev/", title: "  ", selection: "" })).toBe(
      "Page: https://x.dev/",
    );
  });

  it("quotes the selection and truncates a book-length one", () => {
    const message = capturePageMessage({
      url: "https://x.dev/",
      title: "A Page",
      selection: "line one\nline two",
    });
    expect(message).toContain("URL: https://x.dev/");
    expect(message).toContain("> line one\n> line two");

    const long = capturePageMessage({
      url: "https://x.dev/",
      title: "A",
      selection: "s".repeat(CAPTURE_SELECTION_MAX_CHARS + 100),
    });
    expect(long).toContain("[selection truncated]");
    expect(long.length).toBeLessThan(CAPTURE_SELECTION_MAX_CHARS + 400);
  });

  it("omits the selection block when nothing is selected", () => {
    const message = capturePageMessage({ url: "https://x.dev/", title: "A", selection: "  " });
    expect(message).not.toContain("Selected on the page");
  });
});
