// @vitest-environment jsdom

// The keys and bytes are spelled out rather than read off the table: they are what a window's
// storage already holds, and a row that stops reading them loses the user's choice.

import { SIDEBAR_MAX_WIDTH } from "@repo/ui/components/sidebar-core";
import { afterEach, describe, expect, it } from "vitest";
import { APPEARANCE_DEFAULTS } from "../appearance-options";
import { forgetPref, PREFS, readPref, writePref } from "../prefs";
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
    ["inteligir.related-open", "false", PREFS.relatedOpen, false],
    ["inteligir.related-open", "no", PREFS.relatedOpen, true],
    ["inteligir.sidebar-width", "300", PREFS.sidebarWidth, 300],
    ["inteligir.sidebar-width", "9999", PREFS.sidebarWidth, SIDEBAR_MAX_WIDTH],
    ["inteligir.sidebar-width", "wide", PREFS.sidebarWidth, 260],
    ["inteligir.panel-width", "280", PREFS.panelWidth, 280],
    ["inteligir.rail-view", "deleted", PREFS.railView, "deleted"],
    ["inteligir.rail-view", "tags", PREFS.railView, "files"],
    ["inteligir.tree-sort", "modified", PREFS.treeSort, "modified"],
    ["inteligir.tree-sort", "size", PREFS.treeSort, "name"],
    ["inteligir.theme", "dark", PREFS.theme, "dark"],
    ["inteligir.theme", "sepia", PREFS.theme, "system"],
    ["inteligir.last-open-note", "Notes/a.md", PREFS.lastOpenNote, "Notes/a.md"],
    [
      "inteligir.spellcheck",
      '{"enabled":false,"languages":["de-DE"]}',
      PREFS.spellcheck,
      { enabled: false, languages: ["de-DE"] },
    ],
    ["inteligir.spellcheck", "{", PREFS.spellcheck, null],
    [
      "inteligir.appearance",
      '{"font":"serif","leading":"relaxed","measure":"wide","size":"large"}',
      PREFS.appearance,
      { font: "serif", leading: "relaxed", measure: "wide", size: "large" },
    ],
    [
      "inteligir.appearance",
      '{"font":"serif","size":"huge"}',
      PREFS.appearance,
      { ...APPEARANCE_DEFAULTS, font: "serif" },
    ],
    ["inteligir.appearance", "{", PREFS.appearance, APPEARANCE_DEFAULTS],
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
    writePref(PREFS.relatedOpen, false);
    writePref(PREFS.sidebarWidth, 300.4);
    writePref(PREFS.railView, "recent");
    writePref(PREFS.treeSort, "modified");
    writePref(PREFS.theme, "light");
    writePref(PREFS.lastOpenNote, "Notes/a.md");
    writePref(PREFS.spellcheck, { enabled: true, languages: [] });
    writePref(PREFS.appearance, { ...APPEARANCE_DEFAULTS, size: "small" });

    expect(stored("inteligir.panel-open")).toBe("true");
    expect(stored("inteligir.related-open")).toBe("false");
    expect(stored("inteligir.sidebar-width")).toBe("300");
    expect(stored("inteligir.rail-view")).toBe("recent");
    expect(stored("inteligir.tree-sort")).toBe("modified");
    expect(stored("inteligir.theme")).toBe("light");
    expect(stored("inteligir.last-open-note")).toBe("Notes/a.md");
    expect(JSON.parse(stored("inteligir.spellcheck") ?? "null")).toEqual({
      enabled: true,
      languages: [],
    });
    expect(JSON.parse(stored("inteligir.appearance") ?? "null")).toEqual({
      ...APPEARANCE_DEFAULTS,
      size: "small",
    });
  });

  it("forgets a key, which then reads as the fallback", () => {
    writePref(PREFS.lastOpenNote, "Notes/a.md");
    forgetPref(PREFS.lastOpenNote);
    expect(stored("inteligir.last-open-note")).toBeNull();
    expect(readPref(PREFS.lastOpenNote)).toBeNull();
  });
});
