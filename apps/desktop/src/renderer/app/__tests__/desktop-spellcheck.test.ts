// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { SpellcheckChoice, SpellcheckState } from "../../../spellcheck-state";
import { initialUpdateState } from "../../../update-state";
import { applyStoredSpellcheck, chooseSpellcheck } from "../desktop-spellcheck";
import { readSpellcheck, writeSpellcheck } from "../prefs";

const inert = initialUpdateState("0.0.0", "a test stub");
const inertVaults = {
  current: { path: "/home/me/Inteligir", name: "Inteligir" },
  recent: [],
  blocked: null,
};

function state(choice: SpellcheckChoice | null): SpellcheckState {
  return {
    enabled: choice?.enabled ?? true,
    languages: choice?.languages ?? [],
    available: ["en-US", "de-DE"],
    languagesConfigurable: true,
  };
}

function installBridge() {
  const applied: SpellcheckChoice[] = [];
  const log = { applied, reads: 0 };
  window.desktopBridge = {
    socketOrigin: "http://127.0.0.1:1",
    updates: {
      getState: () => Promise.resolve(inert),
      check: () => Promise.resolve(inert),
      download: () => Promise.resolve(inert),
      install: () => Promise.resolve(inert),
      onState: () => () => {},
    },
    spellcheck: {
      getState: () => {
        log.reads += 1;
        return Promise.resolve(state(null));
      },
      apply: (choice) => {
        log.applied.push(choice);
        return Promise.resolve(state(choice));
      },
    },
    paths: {
      reveal: () => Promise.resolve({ ok: true }),
      open: () => Promise.resolve({ ok: true }),
    },
    vaults: {
      getState: () => Promise.resolve(inertVaults),
      pick: () => Promise.resolve(inertVaults),
      open: () => Promise.resolve(inertVaults),
      forget: () => Promise.resolve(inertVaults),
    },
  };
  return log;
}

afterEach(() => {
  delete window.desktopBridge;
  window.localStorage.clear();
});

describe("the stored choice at launch", () => {
  it("is re-applied through the bridge when one was made", async () => {
    writeSpellcheck({ enabled: false, languages: ["de-DE"] });
    const log = installBridge();
    await applyStoredSpellcheck();
    expect(log.applied).toEqual([{ enabled: false, languages: ["de-DE"] }]);
    expect(log.reads).toBe(0);
  });

  it("reads the session's own state when none was made", async () => {
    const log = installBridge();
    await applyStoredSpellcheck();
    expect(log.applied).toEqual([]);
    expect(log.reads).toBe(1);
  });

  it("does nothing in a plain browser tab", async () => {
    writeSpellcheck({ enabled: false, languages: [] });
    await applyStoredSpellcheck();
    expect(readSpellcheck()).toEqual({ enabled: false, languages: [] });
  });
});

describe("choosing", () => {
  it("writes the pref and applies it", async () => {
    const log = installBridge();
    await chooseSpellcheck({ enabled: true, languages: ["en-US", "de-DE"] });
    expect(readSpellcheck()).toEqual({ enabled: true, languages: ["en-US", "de-DE"] });
    expect(log.applied).toEqual([{ enabled: true, languages: ["en-US", "de-DE"] }]);
  });

  it("forgets a malformed pref rather than applying it", () => {
    window.localStorage.setItem("inteligir.spellcheck", "{");
    expect(readSpellcheck()).toBeNull();
  });
});
