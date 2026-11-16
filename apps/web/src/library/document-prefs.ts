// The device's prefs the library's document carries, from before its first paint and on every
// change after, whichever window made it: the appearance dials as the editor's tokens, and spell
// check as the root's own `spellcheck`, which every field inherits unless it sets its own and which
// WebKit's checker honours as a browser's does. The OS picks the languages; the note's title and
// body set theirs off, so the choice reaches the fields around them: the composer, a property.

import { appearanceTokens } from "./appearance-options";
import { devicePrefs } from "./prefs";

export const followDevicePrefs = (root: HTMLElement): (() => void) => {
  const apply = (): void => {
    const { appearance, spellcheck } = devicePrefs.getState();
    for (const { token, css } of appearanceTokens(appearance)) {
      if (css === null) {
        root.style.removeProperty(token);
      } else {
        root.style.setProperty(token, css);
      }
    }
    root.spellcheck = spellcheck;
  };
  apply();
  return devicePrefs.subscribe(apply);
};
