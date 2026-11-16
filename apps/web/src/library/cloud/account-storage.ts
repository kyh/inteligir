// What the page's own storage remembers of the account it was signed in to, which outlives the
// tab, so every way of leaving takes it. The rest of the page's prefs are the device's or the
// window's, and stay.

import { forgetHeadingFolds } from "@repo/editor/heading-collapse";

import { accountPrefs } from "../prefs";

const startOver = (accountId: string | null): void => {
  accountPrefs.setState({ ...accountPrefs.getInitialState(), accountId }, true);
  forgetHeadingFolds();
};

export const forgetAccountStorage = (): void => {
  startOver(null);
};

// A leave no page saw (a session that lapsed with no tab open, a quit in the middle of one) runs
// none of the above, so each open asks whose this is before anything reads it.
export const claimAccountStorage = (accountId: string): void => {
  if (accountPrefs.getState().accountId !== accountId) {
    startOver(accountId);
  }
};
