import { describe, expect, it } from "vitest";

import { shortcutCaps } from "@repo/ui/components/command";

// The chord arrives spelled for the keyboard in use, in one of the two shapes
// `@repo/editor/hotkey-spelling` produces. Cutting it into caps is the only thing this does, and
// a chord it cannot cut must still draw as itself rather than disappear.
describe("shortcutCaps", () => {
  it("cuts a mac chord on its modifier glyphs, leaving the key whole", () => {
    expect(shortcutCaps("⌘P")).toEqual(["⌘", "P"]);
    expect(shortcutCaps("⌘⇧F")).toEqual(["⌘", "⇧", "F"]);
    expect(shortcutCaps("⌃⌥⇧⌘K")).toEqual(["⌃", "⌥", "⇧", "⌘", "K"]);
    expect(shortcutCaps("⌘,")).toEqual(["⌘", ","]);
  });

  it("cuts a word chord on its joiner", () => {
    expect(shortcutCaps("Ctrl+P")).toEqual(["Ctrl", "P"]);
    expect(shortcutCaps("Ctrl+Shift+F")).toEqual(["Ctrl", "Shift", "F"]);
  });

  it("keeps a chord that is one key, and drops nothing from an empty one", () => {
    expect(shortcutCaps("Enter")).toEqual(["Enter"]);
    expect(shortcutCaps("⌘")).toEqual(["⌘"]);
    expect(shortcutCaps("")).toEqual([]);
  });
});
