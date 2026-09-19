// The window session owns the spell checker; this owns the policy, over a port a test can fake.

import type { SpellcheckChoice, SpellcheckState } from "../spellcheck-state";

export interface SpellcheckPort {
  availableLanguages: () => readonly string[];
  isEnabled: () => boolean;
  languages: () => readonly string[];
  setEnabled: (enabled: boolean) => void;
  setLanguages: (languages: readonly string[]) => void;
}

export interface SpellcheckPlan {
  readonly enabled: boolean;
  // null: leave the session's list alone, because nothing chosen is on offer
  readonly languages: readonly string[] | null;
}

export const planSpellcheck = (
  choice: SpellcheckChoice,
  available: readonly string[],
): SpellcheckPlan => {
  const offered = new Set(available);
  const languages = choice.languages.filter((code) => offered.has(code));
  return { enabled: choice.enabled, languages: languages.length === 0 ? null : languages };
};

// macOS hands spelling to the OS checker, which detects the language itself; Electron's setter is a no-op there
export const languagesConfigurableOn = (platform: NodeJS.Platform): boolean =>
  platform !== "darwin";

export interface Spellcheck {
  state: () => SpellcheckState;
  apply: (choice: SpellcheckChoice) => SpellcheckState;
}

export const createSpellcheck = (args: {
  port: SpellcheckPort;
  platform: NodeJS.Platform;
}): Spellcheck => {
  const { port } = args;
  const languagesConfigurable = languagesConfigurableOn(args.platform);
  const state = (): SpellcheckState => ({
    available: [...port.availableLanguages()],
    enabled: port.isEnabled(),
    languages: [...port.languages()],
    languagesConfigurable,
  });
  return {
    apply(choice) {
      const plan = planSpellcheck(choice, port.availableLanguages());
      port.setEnabled(plan.enabled);
      if (languagesConfigurable && plan.languages !== null) {
        port.setLanguages(plan.languages);
      }
      return state();
    },
    state,
  };
};

// the same window that took the bridge; a stranger's webContents has no business on the channel
export const senderIsWindow = <Contents extends object>(
  sender: Contents,
  window: { webContents: Contents } | null,
): boolean => window !== null && sender === window.webContents;
