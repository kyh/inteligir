// The spell checker is the window session's, so main switches it; the page keeps the choice in
// its own prefs and mirrors main's answer. A browser tab owns its own spell check: no bridge,
// no row.

import type { DesktopSpellcheckBridge } from "../../types";
import type { SpellcheckChoice, SpellcheckState } from "../../spellcheck-state";
import { createBridgeStore } from "./bridge-store";
import { readSpellcheck, writeSpellcheck } from "./prefs";

// launch: the stored choice, else what the session already holds
function applyStored(spellcheck: DesktopSpellcheckBridge): Promise<SpellcheckState> {
  const stored = readSpellcheck();
  return stored === null ? spellcheck.getState() : spellcheck.apply(stored);
}

const store = createBridgeStore<DesktopSpellcheckBridge, SpellcheckState>({
  bridge: () => window.desktopBridge?.spellcheck,
  start: (spellcheck, adopt) => {
    applyStored(spellcheck).then(adopt, (cause: unknown) => {
      console.warn("[spellcheck] the session did not answer", cause);
    });
  },
});

export const useDesktopSpellcheck = store.use;

// before the first paint, so the session runs the stored choice from the first keystroke
export function applyStoredSpellcheck(): Promise<void> {
  return store.run(applyStored).catch((cause: unknown) => {
    console.warn("[spellcheck] the session did not answer", cause);
  });
}

// the pref is written first, so a session that refuses still remembers what was asked
export function chooseSpellcheck(choice: SpellcheckChoice): Promise<void> {
  writeSpellcheck(choice);
  return store.run((spellcheck) => spellcheck.apply(choice));
}
