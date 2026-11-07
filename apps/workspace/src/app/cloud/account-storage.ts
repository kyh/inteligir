// What the page's own storage remembers of the account it was signed in to, which outlives the
// replica and the shell's files, so every way of leaving takes it. The rest of the page's prefs
// are the device's, and stay.

import { forgetHeadingFolds } from "@repo/editor/heading-collapse";

import { forgetPref, PREFS } from "../prefs";

export const forgetAccountStorage = (): void => {
  forgetPref(PREFS.libraryScope);
  forgetHeadingFolds();
};
