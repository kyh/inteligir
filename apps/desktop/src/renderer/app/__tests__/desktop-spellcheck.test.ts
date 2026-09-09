// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { SpellcheckChoice, SpellcheckState } from "../../../spellcheck-state";
import { applyStoredSpellcheck, chooseSpellcheck } from "../desktop-spellcheck";
import { readSpellcheck, writeSpellcheck } from "../prefs";
import { inertBridge } from "./inert-bridge";

const state = (choice: SpellcheckChoice | null): SpellcheckState => ({
  available: ["en-US", "de-DE"],
  enabled: choice?.enabled ?? true,
  languages: choice?.languages ?? [],
  languagesConfigurable: true,
});

const installBridge = () => {
  const applied: SpellcheckChoice[] = [];
  const log = { applied, reads: 0 };
  window.desktopBridge = {
    ...inertBridge(),
    /* oxlint-disable require-await -- the bridge is an async port; this fake answers from memory */
    spellcheck: {
      apply: async (choice) => {
        log.applied.push(choice);
        return state(choice);
      },
      getState: async () => {
        log.reads += 1;
        return state(null);
      },
    },
    /* oxlint-enable require-await */
  };
  return log;
};

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
