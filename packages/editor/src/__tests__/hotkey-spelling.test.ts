import { describe, expect, it } from "vitest";

import { spellHotkey } from "../hotkey-spelling";

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
});
