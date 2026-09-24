import { describe, expect, it } from "vitest";

import { hotkeyCaps, spellHotkey } from "../hotkey-spelling";

describe("the spelling of a chord", () => {
  it("follows Apple's modifier order on a mac keyboard and words elsewhere", () => {
    expect(spellHotkey("mod+shift+f", "meta")).toBe("⇧⌘F");
    expect(spellHotkey("mod+alt+f", "meta")).toBe("⌥⌘F");
    expect(spellHotkey("mod+,", "meta")).toBe("⌘,");
    expect(spellHotkey("mod+\\", "meta")).toBe("⌘\\");
    expect(spellHotkey("mod+b", "meta")).toBe("⌘B");
    expect(spellHotkey("mod+shift+f", "ctrl")).toBe("Ctrl+Shift+F");
    expect(spellHotkey("mod+alt+f", "ctrl")).toBe("Ctrl+Alt+F");
    expect(spellHotkey("mod+g", "ctrl")).toBe("Ctrl+G");
  });

  it("spells a bare key as itself", () => {
    expect(spellHotkey("[", "meta")).toBe("[");
    expect(spellHotkey("]", "ctrl")).toBe("]");
  });
});

describe("the caps of a chord", () => {
  it("draws one cap per key, in the same order the spelling runs", () => {
    expect(hotkeyCaps("mod+p", "meta")).toEqual(["⌘", "P"]);
    expect(hotkeyCaps("ctrl+alt+shift+mod+k", "meta")).toEqual(["⌃", "⌥", "⇧", "⌘", "K"]);
    expect(hotkeyCaps("mod+shift+f", "ctrl")).toEqual(["Ctrl", "Shift", "F"]);
    expect(hotkeyCaps("mod+enter", "meta")).toEqual(["⌘", "Enter"]);
  });

  it("folds mod into Ctrl off a mac, where they are one key", () => {
    expect(hotkeyCaps("ctrl+mod+k", "ctrl")).toEqual(["Ctrl", "K"]);
  });
});
