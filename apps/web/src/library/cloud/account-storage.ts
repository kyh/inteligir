import { forgetHeadingFolds } from "@repo/editor/heading-collapse";

import { accountPrefs } from "../prefs";

const startOver = (accountId: string | null) => {
  accountPrefs.setState({ ...accountPrefs.getInitialState(), accountId }, true);
  forgetHeadingFolds();
};

export const forgetAccountStorage = () => {
  startOver(null);
};

export const claimAccountStorage = (accountId: string) => {
  if (accountPrefs.getState().accountId !== accountId) {
    startOver(accountId);
  }
};
