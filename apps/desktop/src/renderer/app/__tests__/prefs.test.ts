// @vitest-environment jsdom

// The keys and bytes are spelled out rather than read off the table: they are what a window's
// storage already holds, and a row that stops reading them loses the user's choice.

import { SIDEBAR_MAX_WIDTH } from "@repo/ui/components/sidebar-core";
import { afterEach, describe, expect, it } from "vitest";
import { PREFS, readPref, writePref } from "../prefs";
import type { PagePref } from "../prefs";

afterEach(() => {
  window.localStorage.clear();
});

const ROWS: readonly PagePref<unknown, unknown>[] = Object.values(PREFS);

const stored = (key: string): string | null => window.localStorage.getItem(key);

describe("the table", () => {
  it("gives every row its own key", () => {
    expect(new Set(ROWS.map((row) => row.key)).size).toBe(ROWS.length);
  });

  it("reads an absent key as the row's fallback", () => {
    for (const row of ROWS) {
      expect(readPref(row), row.key).toEqual(row.fallback);
    }
  });

  it("reads back every fallback it writes", () => {
    for (const row of ROWS.filter((candidate) => candidate.fallback !== null)) {
      writePref(row, row.fallback);
      expect(readPref(row), row.key).toEqual(row.fallback);
    }
  });
});

describe("bytes already in storage", () => {
  const cases: readonly [
    key: string,
    raw: string,
    row: PagePref<unknown, unknown>,
    read: unknown,
  ][] = [
    ["inteligir.panel-open", "true", PREFS.panelOpen, true],
    ["inteligir.panel-open", "yes", PREFS.panelOpen, false],
    ["inteligir.sidebar-width", "300", PREFS.sidebarWidth, 300],
    ["inteligir.sidebar-width", "9999", PREFS.sidebarWidth, SIDEBAR_MAX_WIDTH],
    ["inteligir.sidebar-width", "wide", PREFS.sidebarWidth, 260],
    ["inteligir.panel-width", "280", PREFS.panelWidth, 280],
    ["inteligir.theme", "dark", PREFS.theme, "dark"],
    ["inteligir.theme", "sepia", PREFS.theme, "system"],
    ["inteligir.spellcheck", "false", PREFS.spellcheck, false],
    // the shape an Electron build kept, in a store no window of this build opens, reads as never chosen
    ["inteligir.spellcheck", '{"enabled":false,"languages":["de-DE"]}', PREFS.spellcheck, true],
  ];

  it.each(cases)("%s = %s reads as its value", (key, raw, row, read) => {
    expect(row.key).toBe(key);
    window.localStorage.setItem(key, raw);
    expect(readPref(row)).toEqual(read);
  });
});

describe("a write", () => {
  it("stores the bytes a reader already understands", () => {
    writePref(PREFS.panelOpen, true);
    writePref(PREFS.sidebarWidth, 300.4);
    writePref(PREFS.theme, "light");
    writePref(PREFS.spellcheck, false);

    expect(stored("inteligir.panel-open")).toBe("true");
    expect(stored("inteligir.sidebar-width")).toBe("300");
    expect(stored("inteligir.theme")).toBe("light");
    expect(stored("inteligir.spellcheck")).toBe("false");
  });
});
