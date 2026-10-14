// Spell check is the page's own: the `spellcheck` attribute on the document root, which every
// field inherits unless it sets its own, and which WebKit's checker honours as a browser's does.
// The OS picks the languages. The note's title and body set theirs off, so the choice reaches the
// fields around them: the composer, a comment, a property.

import { PREFS, readPref } from "./prefs";

export const applySpellcheck = (enabled: boolean): void => {
  document.documentElement.spellcheck = enabled;
};

// before the first paint, so a stored "off" never flashes an underline
export const applyStoredSpellcheck = (): void => {
  applySpellcheck(readPref(PREFS.spellcheck));
};
