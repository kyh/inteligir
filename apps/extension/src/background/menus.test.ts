import { describe, expect, it } from "vitest";
import { imageBytesOfDataUrl, MENU_ITEMS, menuAction } from "@/background/menus";

describe("the right-click Save", () => {
  it("offers one item per thing a person points at", () => {
    expect(MENU_ITEMS.map((item) => [item.context, item.title])).toEqual([
      ["page", "Save page"],
      ["link", "Save link"],
      ["image", "Save image"],
      ["selection", "Save as a highlight"],
    ]);
  });

  it("captures the tab for a page or a selection", () => {
    expect(menuAction({ menuItemId: "save-page" })).toEqual({ kind: "page" });
    expect(menuAction({ menuItemId: "save-selection", selectionText: "a passage" })).toEqual({
      kind: "selection",
      text: "a passage",
    });
  });

  it("saves a link or an image by the address the click names, and nothing off the web", () => {
    expect(menuAction({ linkUrl: "https://example.test/a", menuItemId: "save-link" })).toEqual({
      kind: "save",
      save: { target: "link", title: null, url: "https://example.test/a" },
    });
    expect(menuAction({ linkUrl: "mailto:someone@example.test", menuItemId: "save-link" })).toEqual(
      {
        kind: "unsupported",
      },
    );
    expect(menuAction({ menuItemId: "save-image", srcUrl: "https://example.test/i.png" })).toEqual({
      kind: "save",
      save: { src: { kind: "url", url: "https://example.test/i.png" }, target: "image" },
    });
    expect(menuAction({ menuItemId: "save-image", srcUrl: "blob:https://example.test/1" })).toEqual(
      { kind: "unsupported" },
    );
    expect(menuAction({ menuItemId: "something-else" })).toEqual({ kind: "unsupported" });
  });

  it("sends a data: image's bytes under the media type it names", () => {
    expect(
      menuAction({ menuItemId: "save-image", srcUrl: "data:image/png;base64,iVBORw0KGgo=" }),
    ).toEqual({
      kind: "save",
      save: { src: { base64: "iVBORw0KGgo=", kind: "bytes", mime: "image/png" }, target: "image" },
    });
    expect(imageBytesOfDataUrl("data:image/svg+xml,%3Csvg%2F%3E")).toEqual({
      base64: btoa("<svg/>"),
      kind: "bytes",
      mime: "image/svg+xml",
    });
    expect(imageBytesOfDataUrl("data:,no-type")).toBeNull();
    expect(imageBytesOfDataUrl("data:image/png,%E0%A4%A")).toBeNull();
  });
});
