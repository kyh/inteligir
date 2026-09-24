// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import {
  bindingFor,
  GLOBAL_SHORTCUTS,
  globalShortcutFor,
  useGlobalShortcuts,
} from "../global-shortcuts";
import type { GlobalShortcutAction } from "../global-shortcuts";

afterEach(cleanup);

const keydown = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", { key: "k", ...init });

const mountListener = (modifier: ShortcutModifier): GlobalShortcutAction[] => {
  const fired: GlobalShortcutAction[] = [];
  const Harnessed = () => {
    useGlobalShortcuts(modifier, (action) => {
      fired.push(action);
    });
    return <div />;
  };
  render(<Harnessed />);
  return fired;
};

describe("the window listener", () => {
  it("fires the table's action for a claimed key", () => {
    const fired = mountListener("ctrl");
    fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
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
        ctrlKey: shortcut.bare !== true,
        key: shortcut.key,
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
    expect(globalShortcutFor(keydown({ altKey: true, metaKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ ctrlKey: true, metaKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({}), "meta")).toBeNull();
  });

  it("tells a shifted key from its unshifted row, whatever case the key reports", () => {
    expect(globalShortcutFor(keydown({ key: "f", metaKey: true }), "meta")?.action).toBe(
      "find-in-note",
    );
    expect(
      globalShortcutFor(keydown({ key: "O", metaKey: true, shiftKey: true }), "meta")?.action,
    ).toBe("open-headings");
    expect(
      globalShortcutFor(keydown({ altKey: true, key: "f", metaKey: true, shiftKey: true }), "meta"),
    ).toBeNull();
  });

  it("answers a bare key outside a field, and only with no modifier held", () => {
    expect(globalShortcutFor(keydown({ key: "[" }), "meta")?.action).toBe("toggle-rail");
    expect(globalShortcutFor(keydown({ key: "]" }), "ctrl")?.action).toBe("toggle-panel");
    expect(globalShortcutFor(keydown({ key: "[", metaKey: true }), "meta")).toBeNull();
    expect(globalShortcutFor(keydown({ ctrlKey: true, key: "]" }), "ctrl")).toBeNull();
    expect(globalShortcutFor(keydown({ altKey: true, key: "[" }), "meta")).toBeNull();
  });

  it("leaves a bare key to the field it is typed into", () => {
    const fired = mountListener("meta");
    const field = document.createElement("input");
    document.body.append(field);
    fireEvent.keyDown(field, { key: "[" });
    fireEvent.keyDown(document.body, { key: "[" });
    field.remove();
    expect(fired).toEqual(["toggle-rail"]);
  });
});

describe("the spelling", () => {
  it("answers a binding by its action from the table", () => {
    expect(bindingFor("open-palette", "meta")).toBe("⌘P");
    expect(bindingFor("open-settings", "ctrl")).toBe("Ctrl+,");
    expect(bindingFor("toggle-rail", "meta")).toBe("[");
  });
});
