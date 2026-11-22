import { forgetHeadingFolds } from "@repo/editor/heading-collapse";
import { forgetUnsentNotes } from "@repo/editor/item/unsent-notes";

import { accountPrefs } from "../prefs";

const startOver = (accountId: string | null) => {
  accountPrefs.setState({ ...accountPrefs.getInitialState(), accountId }, true);
  forgetHeadingFolds();
  forgetUnsentNotes(typeof localStorage === "undefined" ? null : localStorage);
};

export const forgetAccountStorage = () => {
  startOver(null);
};

export const claimAccountStorage = (accountId: string) => {
  if (accountPrefs.getState().accountId !== accountId) {
    startOver(accountId);
  }
};
