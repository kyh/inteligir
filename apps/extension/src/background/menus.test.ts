import { describe, expect, it } from "vitest";

import { bytesOfDataUrl, MENU_ITEMS, menuAction } from "./menus";

describe("the right-click Save", () => {
  it("offers one item per thing a person points at", () => {
    expect(MENU_ITEMS.map((item) => [item.context, item.title])).toStrictEqual([
      ["page", "Save page"],
      ["link", "Save link"],
      ["image", "Save image"],
      ["selection", "Save as a highlight"],
    ]);
  });

  it("reads the tab for a page or a selection", () => {
    expect(menuAction({ menuItemId: "save-page" })).toStrictEqual({ kind: "page" });
    expect(menuAction({ menuItemId: "save-selection", selectionText: "a passage" })).toStrictEqual({
      kind: "selection",
      text: "a passage",
    });
  });

  it("saves a link or a web picture by the address the click names, and nothing off the web", () => {
    expect(
      menuAction({ linkUrl: "https://example.test/a", menuItemId: "save-link" }),
    ).toStrictEqual({
      kind: "address",
      url: "https://example.test/a",
    });
    expect(
      menuAction({ linkUrl: "mailto:someone@example.test", menuItemId: "save-link" }),
    ).toStrictEqual({
      kind: "unsupported",
    });
    expect(
      menuAction({ menuItemId: "save-image", srcUrl: "https://example.test/i.png" }),
    ).toStrictEqual({
      kind: "address",
      url: "https://example.test/i.png",
    });
    expect(
      menuAction({ menuItemId: "save-image", srcUrl: "blob:https://example.test/1" }),
    ).toStrictEqual({
      kind: "unsupported",
    });
    expect(menuAction({ menuItemId: "something-else" })).toStrictEqual({ kind: "unsupported" });
  });

  it("saves a picture a page drew from its own bytes by those bytes", () => {
    expect(
      menuAction({ menuItemId: "save-image", srcUrl: "data:image/png;base64,iVBORw0KGgo=" }),
    ).toStrictEqual({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      kind: "picture",
    });
  });
});

describe("a data: address's bytes", () => {
  it("are its base64, or its percent-encoded body byte for byte, a binary escape included", () => {
    expect(bytesOfDataUrl("data:image/png;base64,iVBORw0KGgo=")).toStrictEqual(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // %89 is no UTF-8, and still the one byte a PNG starts with
    expect(bytesOfDataUrl("data:image/png,%89PNG%0D%0A")).toStrictEqual(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
    );
    // copied into this realm's Uint8Array: jsdom's TextEncoder answers node's
    expect(bytesOfDataUrl("data:image/svg+xml,<svg>é</svg>")).toStrictEqual(
      Uint8Array.from(new TextEncoder().encode("<svg>é</svg>")),
    );
  });

  it("are none for a body that is not one", () => {
    expect(bytesOfDataUrl("data:image/png;base64,***")).toBeNull();
    expect(bytesOfDataUrl("data:image/png,100%")).toBeNull();
    expect(bytesOfDataUrl("https://example.test/i.png")).toBeNull();
  });
});
