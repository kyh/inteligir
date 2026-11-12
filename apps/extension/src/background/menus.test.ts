import { describe, expect, it } from "vitest";

import { bytesOfDataUrl, MENU_ITEMS, menuAction } from "./menus";

describe("the right-click Save", () => {
  it("offers one item per thing a person points at", () => {
    expect(MENU_ITEMS.map((item) => [item.context, item.title])).toStrictEqual([
      ["page", "Save page"],
      ["link", "Save link"],
      ["image", "Save image"],
    ]);
  });

  it("reads the tab for a page", async () => {
    expect(await menuAction({ menuItemId: "save-page" })).toStrictEqual({ kind: "page" });
  });

  it("saves a link or a web picture by the address the click names, and nothing off the web", async () => {
    expect(
      await menuAction({ linkUrl: "https://example.test/a", menuItemId: "save-link" }),
    ).toStrictEqual({
      kind: "address",
      url: "https://example.test/a",
    });
    expect(
      await menuAction({ linkUrl: "mailto:someone@example.test", menuItemId: "save-link" }),
    ).toStrictEqual({
      kind: "unsupported",
    });
    expect(
      await menuAction({ menuItemId: "save-image", srcUrl: "https://example.test/i.png" }),
    ).toStrictEqual({
      kind: "address",
      url: "https://example.test/i.png",
    });
    expect(
      await menuAction({ menuItemId: "save-image", srcUrl: "blob:https://example.test/1" }),
    ).toStrictEqual({
      kind: "unsupported",
    });
    expect(await menuAction({ menuItemId: "something-else" })).toStrictEqual({
      kind: "unsupported",
    });
  });

  it("saves a picture a page drew from its own bytes by those bytes", async () => {
    expect(
      await menuAction({ menuItemId: "save-image", srcUrl: "data:image/png;base64,iVBORw0KGgo=" }),
    ).toStrictEqual({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      kind: "picture",
    });
  });
});

describe("a data: address's bytes", () => {
  it("are its base64, or its percent-encoded body byte for byte, a binary escape included", async () => {
    expect(await bytesOfDataUrl("data:image/png;base64,iVBORw0KGgo=")).toStrictEqual(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // %89 is no UTF-8, and still the one byte a PNG starts with
    expect(await bytesOfDataUrl("data:image/png,%89PNG%0D%0A")).toStrictEqual(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
    );
    // copied into this realm's Uint8Array: jsdom's TextEncoder answers node's
    expect(await bytesOfDataUrl("data:image/svg+xml,<svg>é</svg>")).toStrictEqual(
      Uint8Array.from(new TextEncoder().encode("<svg>é</svg>")),
    );
  });

  // as the browser reads one: its body percent-decoded first, then its base64
  it("are its base64 with its escapes decoded, as the picture the browser draws", async () => {
    const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await bytesOfDataUrl("data:image/png;base64,iVBORw0KGgo%3D")).toStrictEqual(signature);
    expect(await bytesOfDataUrl("data:image/png;base64,iVBOR%0Aw0KGgo=")).toStrictEqual(signature);
    expect(
      await menuAction({
        menuItemId: "save-image",
        srcUrl: "data:image/png;base64,iVBORw0KGgo%3D",
      }),
    ).toStrictEqual({ bytes: signature, kind: "picture" });
  });

  it("are a large run of plain text whole, past what a call's arguments hold", async () => {
    const run = "a".repeat(200_000);
    expect(await bytesOfDataUrl(`data:image/svg+xml;utf8,<svg>${run}</svg>`)).toStrictEqual(
      Uint8Array.from(new TextEncoder().encode(`<svg>${run}</svg>`)),
    );
  });

  it("are a stray % as the byte it spells, as the browser reads it", async () => {
    expect(await bytesOfDataUrl("data:image/png,100%")).toStrictEqual(
      Uint8Array.from(new TextEncoder().encode("100%")),
    );
  });

  it("are none for a body that is not one", async () => {
    expect(await bytesOfDataUrl("data:image/png;base64,***")).toBeNull();
    expect(await bytesOfDataUrl("data:image/png;base64,iVBORw0KGgo%")).toBeNull();
    expect(await bytesOfDataUrl("https://example.test/i.png")).toBeNull();
  });
});
