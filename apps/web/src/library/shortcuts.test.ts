// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { hotkeyFor, shortcutFor } from "./shortcuts";

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent("keydown", init);

describe("the tab's table", () => {
  it("spells each row the way is-hotkey does", () => {
    expect(hotkeyFor("select-all")).toBe("mod+a");
    expect(hotkeyFor("extend-down")).toBe("shift+down");
    expect(hotkeyFor("delete-selection")).toBe("mod+backspace");
    expect(hotkeyFor("quick-look")).toBe("space");
    expect(hotkeyFor("save-clipboard")).toBe("mod+v");
    expect(hotkeyFor("toggle-rail")).toBe("[");
  });

  it("reads a key for the listener it belongs to", () => {
    expect(shortcutFor(key({ key: "ArrowRight" }), "grid", "meta")?.action).toBe("move-right");
    expect(shortcutFor(key({ key: "ArrowDown", shiftKey: true }), "grid", "meta")?.action).toBe(
      "extend-down",
    );
    expect(shortcutFor(key({ key: " " }), "grid", "meta")?.action).toBe("quick-look");
    expect(shortcutFor(key({ key: "Escape" }), "grid", "meta")?.action).toBe("clear-selection");
    expect(shortcutFor(key({ key: "Escape" }), "item", "meta")?.action).toBe("back-to-library");
    expect(shortcutFor(key({ key: "Enter" }), "item", "meta")).toBeNull();
    expect(shortcutFor(key({ key: "k", metaKey: true }), "window", "meta")?.action).toBe(
      "open-agent",
    );
    expect(shortcutFor(key({ key: "v", metaKey: true }), "window", "meta")).toBeNull();
  });

  it("holds the modifier to the platform's", () => {
    expect(shortcutFor(key({ key: "a", metaKey: true }), "grid", "meta")?.action).toBe(
      "select-all",
    );
    expect(shortcutFor(key({ ctrlKey: true, key: "a" }), "grid", "meta")).toBeNull();
    expect(shortcutFor(key({ ctrlKey: true, key: "A" }), "grid", "ctrl")?.action).toBe(
      "select-all",
    );
    expect(shortcutFor(key({ key: "a" }), "grid", "meta")).toBeNull();
    expect(
      shortcutFor(key({ key: "K", metaKey: true, shiftKey: true }), "window", "meta"),
    ).toBeNull();
  });

  it("leaves a key inside an IME composition to the composer", () => {
    expect(shortcutFor(key({ isComposing: true, key: "Enter" }), "grid", "meta")).toBeNull();
    // oxlint-disable-next-line typescript/no-deprecated -- Safari's composing Enter, as ime.ts reads it
    expect(shortcutFor(key({ key: "Enter", keyCode: 229 }), "grid", "meta")).toBeNull();
    expect(shortcutFor(key({ key: "Enter" }), "grid", "meta")?.action).toBe("open-item");
  });

  it("takes no chord with alt, and no bare key that claims a modifier", () => {
    expect(shortcutFor(key({ altKey: true, key: "ArrowLeft" }), "grid", "meta")).toBeNull();
    expect(shortcutFor(key({ key: "Backspace" }), "grid", "meta")).toBeNull();
    expect(shortcutFor(key({ key: "ArrowLeft", metaKey: true }), "grid", "meta")).toBeNull();
  });

  it("leaves an unmodified key typed in a field to the field", () => {
    const field = document.createElement("input");
    document.body.append(field);
    const typed = new KeyboardEvent("keydown", { bubbles: true, key: "[" });
    let read: string | null | undefined;
    field.addEventListener("keydown", (event) => {
      read = shortcutFor(event, "window", "meta")?.action ?? null;
    });
    field.dispatchEvent(typed);
    field.remove();
    expect(read).toBeNull();
    expect(shortcutFor(key({ key: "[" }), "window", "meta")?.action).toBe("toggle-rail");
  });
});
