// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindingFor,
  GLOBAL_SHORTCUTS,
  globalShortcutFor,
  platformShortcutModifier,
  spellHotkey,
  useGlobalShortcuts,
  type GlobalShortcutAction,
  type ShortcutModifier,
} from "../global-shortcuts";

afterEach(cleanup);

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "k", ...init });
}

function mountListener(modifier: ShortcutModifier): GlobalShortcutAction[] {
  const fired: GlobalShortcutAction[] = [];
  function Harnessed() {
    useGlobalShortcuts(modifier, (action) => {
      fired.push(action);
    });
    return <div />;
  }
  render(<Harnessed />);
  return fired;
}

describe("the window listener", () => {
  it("fires the table's action for a claimed key", () => {
    const fired = mountListener("ctrl");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(fired).toEqual(["open-action-composer"]);
  });

  it("ignores the other modifier", () => {
    const fired = mountListener("ctrl");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(fired).toEqual([]);
  });

  it("covers every table row", () => {
    const fired = mountListener("ctrl");
    for (const shortcut of GLOBAL_SHORTCUTS) {
      fireEvent.keyDown(window, {
        key: shortcut.key,
        ctrlKey: true,
        shiftKey: shortcut.shift === true,
      });
    }
    expect(fired).toEqual(GLOBAL_SHORTCUTS.map((shortcut) => shortcut.action));
  });
});

describe("the matcher", () => {
  it("claims Ctrl off a non-Apple user agent", () => {
    expect(platformShortcutModifier()).toBe("ctrl");
  });

  it("claims exactly one modifier", () => {
    expect(globalShortcutFor(keydown({ metaKey: true }), "meta")?.action).toBe(
      "open-action-composer",
    );
    expect(globalShortcutFor(keydown({ ctrlKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ ctrlKey: true }), "ctrl")?.action).toBe(
      "open-action-composer",
    );
    expect(globalShortcutFor(keydown({ metaKey: true }), "ctrl")).toBeNull();
  });

  it("refuses a combination carrying any other modifier", () => {
    expect(globalShortcutFor(keydown({ metaKey: true, shiftKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ metaKey: true, altKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ metaKey: true, ctrlKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({}), "meta")).toBeNull();
  });

  it("tells a shifted key from its unshifted row, whatever case the key reports", () => {
    expect(globalShortcutFor(keydown({ key: "f", metaKey: true }), "meta")?.action).toBe(
      "find-in-note",
    );
    expect(
      globalShortcutFor(keydown({ key: "F", metaKey: true, shiftKey: true }), "meta")?.action,
    ).toBe("open-search");
    expect(
      globalShortcutFor(keydown({ key: "f", metaKey: true, shiftKey: true, altKey: true }), "meta"),
    ).toBeNull();
  });
});

describe("the spelling", () => {
  it("follows Apple's modifier order on a mac keyboard and words elsewhere", () => {
    expect(spellHotkey("mod+shift+f", "meta")).toBe("⇧⌘F");
    expect(spellHotkey("mod+alt+f", "meta")).toBe("⌥⌘F");
    expect(spellHotkey("mod+,", "meta")).toBe("⌘,");
    expect(spellHotkey("mod+\\", "meta")).toBe("⌘\\");
    expect(spellHotkey("mod+shift+f", "ctrl")).toBe("Ctrl+Shift+F");
    expect(spellHotkey("mod+alt+f", "ctrl")).toBe("Ctrl+Alt+F");
    expect(spellHotkey("mod+g", "ctrl")).toBe("Ctrl+G");
  });

  it("answers a binding by its action from the table", () => {
    expect(bindingFor("open-quick-switcher", "meta")).toBe("⌘O");
    expect(bindingFor("open-settings", "ctrl")).toBe("Ctrl+,");
  });
});
