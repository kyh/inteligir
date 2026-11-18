import { appearanceTokens } from "./appearance-options";
import { devicePrefs } from "./prefs";

export const followDevicePrefs = (root: HTMLElement) => {
  const apply = () => {
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
