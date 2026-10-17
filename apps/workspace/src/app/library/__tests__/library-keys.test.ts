// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { LIBRARY_SHORTCUTS, libraryShortcutFor, libraryShortcutHotkey } from "../library-keys";
import type { LibraryKeyEvent } from "../library-keys";

// a key as a React listener hands it over: its fields, and the native event under them
const key = (init: KeyboardEventInit): LibraryKeyEvent => {
  const nativeEvent = new KeyboardEvent("keydown", init);
  return {
    altKey: nativeEvent.altKey,
    ctrlKey: nativeEvent.ctrlKey,
    key: nativeEvent.key,
    metaKey: nativeEvent.metaKey,
    nativeEvent,
    shiftKey: nativeEvent.shiftKey,
  };
};

describe("the library's table", () => {
  it("spells each row the way is-hotkey does", () => {
    const spelled = new Map(
      LIBRARY_SHORTCUTS.map((row) => [row.action, libraryShortcutHotkey(row)]),
    );
    expect(spelled.get("select-all")).toBe("mod+a");
    expect(spelled.get("extend-down")).toBe("shift+down");
    expect(spelled.get("delete-selection")).toBe("mod+backspace");
    expect(spelled.get("quick-look")).toBe("space");
    expect(spelled.get("save-clipboard")).toBe("mod+v");
  });

  it("reads a key for the listener it belongs to", () => {
    expect(libraryShortcutFor(key({ key: "ArrowRight" }), "grid", "meta")?.action).toBe(
      "move-right",
    );
    expect(
      libraryShortcutFor(key({ key: "ArrowDown", shiftKey: true }), "grid", "meta")?.action,
    ).toBe("extend-down");
    expect(libraryShortcutFor(key({ key: " " }), "grid", "meta")?.action).toBe("quick-look");
    expect(libraryShortcutFor(key({ key: "Escape" }), "grid", "meta")?.action).toBe(
      "clear-selection",
    );
    expect(libraryShortcutFor(key({ key: "Escape" }), "item", "meta")?.action).toBe(
      "back-to-library",
    );
    expect(libraryShortcutFor(key({ key: "Enter" }), "item", "meta")).toBeNull();
  });

  it("holds the modifier to the platform's", () => {
    expect(libraryShortcutFor(key({ key: "a", metaKey: true }), "grid", "meta")?.action).toBe(
      "select-all",
    );
    expect(libraryShortcutFor(key({ ctrlKey: true, key: "a" }), "grid", "meta")).toBeNull();
    expect(libraryShortcutFor(key({ ctrlKey: true, key: "A" }), "grid", "ctrl")?.action).toBe(
      "select-all",
    );
    expect(libraryShortcutFor(key({ key: "a" }), "grid", "meta")).toBeNull();
  });

  it("leaves a key inside an IME composition to the composer", () => {
    expect(libraryShortcutFor(key({ isComposing: true, key: "Enter" }), "grid", "meta")).toBeNull();
    expect(libraryShortcutFor(key({ key: "Enter", keyCode: 229 }), "grid", "meta")).toBeNull();
    expect(libraryShortcutFor(key({ key: "Enter" }), "grid", "meta")?.action).toBe("open-item");
  });

  it("takes no chord with alt, and no bare key that claims a modifier", () => {
    expect(libraryShortcutFor(key({ altKey: true, key: "ArrowLeft" }), "grid", "meta")).toBeNull();
    expect(libraryShortcutFor(key({ key: "Backspace" }), "grid", "meta")).toBeNull();
    expect(libraryShortcutFor(key({ key: "ArrowLeft", metaKey: true }), "grid", "meta")).toBeNull();
  });
});
