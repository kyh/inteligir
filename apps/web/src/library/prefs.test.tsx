import { SIDEBAR_MAX_WIDTH } from "@repo/ui/lib/sidebar-bounds";
import { afterEach, describe, expect, it, vi } from "vitest";

import { APPEARANCE_DEFAULTS } from "./appearance-options";
import { accountPrefs, devicePrefs, windowLayout } from "./prefs";

afterEach(() => {
  vi.restoreAllMocks();
  devicePrefs.setState(devicePrefs.getInitialState(), true);
  windowLayout.setState(windowLayout.getInitialState(), true);
  accountPrefs.setState(accountPrefs.getInitialState(), true);
  window.localStorage.clear();
});

type Stored =
  | string
  | number
  | boolean
  | null
  | readonly Stored[]
  | { readonly [key: string]: Stored };

const blob = (state: Stored) => JSON.stringify({ state, version: 0 });

const stored = (name: string) => window.localStorage.getItem(name);

const STORAGE_QUOTA = 5_000_000;
const FILLER = "filler";

const fillStorage = () => {
  const storage = window.localStorage;
  let used = 0;

  for (let at = 0; at < storage.length; at += 1) {
    const key = storage.key(at) ?? "";
    used += key.length + (storage.getItem(key) ?? "").length;
  }

  storage.setItem(FILLER, "x".repeat(STORAGE_QUOTA - used - FILLER.length - 8));
};

const writtenElsewhere = (name: string, state: Stored) => {
  const raw = blob(state);
  window.localStorage.setItem(name, raw);
  window.dispatchEvent(new StorageEvent("storage", { key: name, newValue: raw }));
};

describe("a store with nothing stored", () => {
  it("reads every field as its default", () => {
    expect(devicePrefs.getState()).toStrictEqual({
      appearance: APPEARANCE_DEFAULTS,
      spellcheck: true,
      theme: "system",
    });
    expect(windowLayout.getState()).toStrictEqual({
      librarySort: "saved",
      panelOpen: false,
      panelWidth: 320,
      railOpen: true,
      railTagsOpen: true,
      railWidth: 260,
    });
    expect(accountPrefs.getState()).toStrictEqual({ accountId: null });
  });
});

describe("a blob already in storage", () => {
  it("reads field by field, a field it cannot read as that field's default", async () => {
    window.localStorage.setItem(
      "inteligir.prefs",
      blob({ appearance: { font: "serif", size: "huge" }, spellcheck: false, theme: "sepia" }),
    );
    window.localStorage.setItem(
      "inteligir.layout",
      blob({
        librarySort: "size",
        panelOpen: "yes",
        panelWidth: 280.4,
        railOpen: false,
        railTagsOpen: false,
        railWidth: 9999,
      }),
    );
    window.localStorage.setItem("inteligir.account", blob({ accountId: 7 }));
    await devicePrefs.persist.rehydrate();
    await windowLayout.persist.rehydrate();
    await accountPrefs.persist.rehydrate();

    expect(devicePrefs.getState()).toStrictEqual({
      appearance: { ...APPEARANCE_DEFAULTS, font: "serif" },
      spellcheck: false,
      theme: "system",
    });
    expect(windowLayout.getState()).toStrictEqual({
      librarySort: "saved",
      panelOpen: false,
      panelWidth: 280,
      railOpen: false,
      railTagsOpen: false,
      railWidth: SIDEBAR_MAX_WIDTH,
    });
    expect(accountPrefs.getState()).toStrictEqual({ accountId: null });
  });

  it("reads one it cannot parse as every default", async () => {
    window.localStorage.setItem("inteligir.prefs", "{");
    window.localStorage.setItem("inteligir.layout", blob("wide"));
    await devicePrefs.persist.rehydrate();
    await windowLayout.persist.rehydrate();
    expect(devicePrefs.getState()).toStrictEqual(devicePrefs.getInitialState());
    expect(windowLayout.getState()).toStrictEqual(windowLayout.getInitialState());
  });
});

describe("a write", () => {
  it("stores the whole blob, its theme where the no-flash script reads it", () => {
    devicePrefs.setState({ theme: "dark" });
    accountPrefs.setState({ accountId: "user-1" });
    expect(stored("inteligir.prefs")).toBe(
      blob({ appearance: APPEARANCE_DEFAULTS, spellcheck: true, theme: "dark" }),
    );
    expect(stored("inteligir.account")).toBe(blob({ accountId: "user-1" }));
  });

  it("keeps the choice for the session when storage refuses it", () => {
    const refused = vi.spyOn(Storage.prototype, "setItem");
    fillStorage();

    try {
      devicePrefs.setState({ theme: "light" });
      expect(devicePrefs.getState().theme).toBe("light");
      expect(refused.mock.results.at(-1)?.type).toBe("throw");
    } finally {
      window.localStorage.removeItem(FILLER);
    }
  });
});

describe("another window's write", () => {
  it("reaches the device's prefs, so this window's next write keeps it", () => {
    writtenElsewhere("inteligir.prefs", {
      appearance: APPEARANCE_DEFAULTS,
      spellcheck: true,
      theme: "dark",
    });
    expect(devicePrefs.getState().theme).toBe("dark");

    devicePrefs.setState({ spellcheck: false });
    expect(stored("inteligir.prefs")).toBe(
      blob({ appearance: APPEARANCE_DEFAULTS, spellcheck: false, theme: "dark" }),
    );
  });

  it("stays out of this window's layout", () => {
    writtenElsewhere("inteligir.layout", { panelOpen: true });
    expect(windowLayout.getState().panelOpen).toBe(false);
  });
});
