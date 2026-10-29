// the toolbar's badge says how a save went on the tab it was made from: "…" while it runs, "✓"
// for two seconds once it lands, or "!" with the reason as the button's title until the next save

import { refusalCopy, savedCopy } from "@/outcome-copy";
import type { Outcome } from "@/messages";

const DEFAULT_TITLE = "Save to Inteligir";
const SAVED_SHOWN_MS = 2000;

// a tab closed while its save ran has no badge to set, which is no failure of the save
const setBadge = async (tabId: number, text: string, title: string | null): Promise<void> => {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (title !== null) {
      await chrome.action.setTitle({ tabId, title });
    }
  } catch {
    // the tab is gone
  }
};

export const showSaving = async (tabId: number): Promise<void> => {
  await setBadge(tabId, "…", DEFAULT_TITLE);
};

export const showOutcome = async (tabId: number, outcome: Outcome): Promise<void> => {
  if (outcome.kind === "refused") {
    await setBadge(tabId, "!", refusalCopy(outcome.reason).text);
    return;
  }
  await setBadge(tabId, "✓", outcome.kind === "saved" ? savedCopy(outcome.created) : null);
  setTimeout(() => {
    void setBadge(tabId, "", DEFAULT_TITLE);
  }, SAVED_SHOWN_MS);
};
