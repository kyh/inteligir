import { afterEach, expect, it } from "vitest";

import { APPEARANCE_DEFAULTS } from "./appearance-options";
import { followDevicePrefs } from "./document-prefs";
import { devicePrefs } from "./prefs";

afterEach(() => {
  devicePrefs.setState(devicePrefs.getInitialState(), true);
  window.localStorage.clear();
});

it("carries the stored dials and spell check before anything draws, and every change after", () => {
  devicePrefs.setState({
    appearance: { ...APPEARANCE_DEFAULTS, size: "large" },
    spellcheck: false,
  });
  const root = document.createElement("div");
  const stop = followDevicePrefs(root);
  expect(root.style.getPropertyValue("--editor-size")).toBe("16px");
  expect(root.spellcheck).toBe(false);

  devicePrefs.setState({ appearance: APPEARANCE_DEFAULTS, spellcheck: true });
  expect(root.style.getPropertyValue("--editor-size")).toBe("");
  expect(root.spellcheck).toBe(true);
  stop();
});
