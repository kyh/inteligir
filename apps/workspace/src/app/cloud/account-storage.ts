// What the page's own storage remembers of the account it was signed in to, which outlives the
// replica, so every way of leaving takes it. The rest of the page's prefs are the device's, and
// stay.

import { forgetHeadingFolds } from "@repo/editor/heading-collapse";

import { forgetPref, PREFS, readPref, writePref } from "../prefs";

export const forgetAccountStorage = (): void => {
  forgetPref(PREFS.libraryScope);
  forgetPref(PREFS.storageAccount);
  forgetHeadingFolds();
};

// A leave no page saw (a session that lapsed with no tab open, a quit in the middle of one) runs
// none of the above, so each open asks whose this is before anything reads it.
export const claimAccountStorage = (accountId: string): void => {
  if (readPref(PREFS.storageAccount) === accountId) {
    return;
  }
  forgetAccountStorage();
  writePref(PREFS.storageAccount, accountId);
};
