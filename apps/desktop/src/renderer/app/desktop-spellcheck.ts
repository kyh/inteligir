// The spell checker is the window session's, so main switches it; the page keeps the choice in
// its own prefs and mirrors main's answer. A browser tab owns its own spell check: no bridge,
// no row.

import type { DesktopSpellcheckBridge } from "../../types";
import type { SpellcheckChoice, SpellcheckState } from "../../spellcheck-state";
import { createBridgeStore } from "./bridge-store";
import { readSpellcheck, writeSpellcheck } from "./prefs";

// launch: the stored choice, else what the session already holds
const applyStored = async (spellcheck: DesktopSpellcheckBridge): Promise<SpellcheckState> => {
  const stored = readSpellcheck();
  return stored === null ? await spellcheck.getState() : await spellcheck.apply(stored);
};

const adoptStored = async (
  spellcheck: DesktopSpellcheckBridge,
  adopt: (state: SpellcheckState) => void,
): Promise<void> => {
  let state;
  try {
    state = await applyStored(spellcheck);
  } catch (error) {
    console.warn("[spellcheck] the session did not answer", error);
    return;
  }
  adopt(state);
};

const store = createBridgeStore<DesktopSpellcheckBridge, SpellcheckState>({
  bridge: () => window.desktopBridge?.spellcheck,
  start: (spellcheck, adopt) => {
    void adoptStored(spellcheck, adopt);
  },
});

export const useDesktopSpellcheck = store.use;

// before the first paint, so the session runs the stored choice from the first keystroke
export const applyStoredSpellcheck = async (): Promise<void> => {
  try {
    await store.run(applyStored);
  } catch (error) {
    console.warn("[spellcheck] the session did not answer", error);
  }
};

// the pref is written first, so a session that refuses still remembers what was asked
export const chooseSpellcheck = async (choice: SpellcheckChoice): Promise<void> => {
  writeSpellcheck(choice);
  await store.run(async (spellcheck) => await spellcheck.apply(choice));
};
