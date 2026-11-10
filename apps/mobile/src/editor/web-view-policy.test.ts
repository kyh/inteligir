import { describe, expect, it } from "vitest";
import { loadVerdict, openWindowVerdict } from "./web-view-policy";

const PAGE =
  "file:///private/var/containers/Bundle/Application/A/Inteligir.app/www.bundle/0a1b.html";
const UPDATE_PAGE =
  "file:///var/mobile/Containers/Data/Application/B/Library/Application%20Support/.expo-internal/c2d3/www.bundle/0a1b.html";
const DEV_PAGE =
  "http://192.168.1.20:8081/_expo/@dom/note-page.tsx?file=file:///repo/note-page.tsx";

describe("what the note page's web view may load", () => {
  it("loads the page wherever the app or an update keeps it, as it opens or reloads", () => {
    for (const url of [PAGE, UPDATE_PAGE]) {
      expect(loadVerdict({ isTopFrame: true, navigationType: "other", url }, false)).toStrictEqual({
        kind: "allow",
      });
      expect(loadVerdict({ isTopFrame: true, navigationType: "reload", url }, false)).toStrictEqual(
        { kind: "allow" },
      );
    }
  });

  it("loads the dev server's page only in a dev build", () => {
    const request = { isTopFrame: true, navigationType: "other", url: DEV_PAGE } as const;
    expect(loadVerdict(request, true)).toStrictEqual({ kind: "allow" });
    expect(loadVerdict(request, false)).toStrictEqual({ kind: "refuse" });
  });

  it("loads child frames only the page itself makes", () => {
    expect(
      loadVerdict({ isTopFrame: false, navigationType: "other", url: "about:srcdoc" }, false),
    ).toStrictEqual({ kind: "allow" });
    for (const url of ["https://example.com/", PAGE]) {
      expect(loadVerdict({ isTopFrame: false, navigationType: "other", url }, true)).toStrictEqual({
        kind: "refuse",
      });
    }
  });

  it("hands a followed web link to Safari and refuses every other page", () => {
    expect(
      loadVerdict(
        { isTopFrame: true, navigationType: "click", url: "https://example.com/a" },
        false,
      ),
    ).toStrictEqual({ kind: "open-outside", url: "https://example.com/a" });
    for (const url of [
      "about:blank",
      "file:///etc/passwd",
      "inteligir://item/a",
      "tel:5551234",
      ["javascript", "alert(1)"].join(":"),
    ]) {
      expect(loadVerdict({ isTopFrame: true, navigationType: "click", url }, false)).toStrictEqual({
        kind: "refuse",
      });
    }
    for (const navigationType of ["formsubmit", "backforward", "formresubmit"] as const) {
      expect(loadVerdict({ isTopFrame: true, navigationType, url: PAGE }, false)).toStrictEqual({
        kind: "refuse",
      });
    }
    expect(
      loadVerdict(
        { isTopFrame: true, navigationType: "other", url: "https://example.com/" },
        false,
      ),
    ).toStrictEqual({ kind: "refuse" });
    expect(openWindowVerdict("http://example.com/")).toStrictEqual({
      kind: "open-outside",
      url: "http://example.com/",
    });
    expect(openWindowVerdict("file:///etc/passwd")).toStrictEqual({ kind: "refuse" });
  });
});
