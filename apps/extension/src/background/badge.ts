// the toolbar's badge says how a save went on the tab it was made from: "…" while it runs, "✓"
// for two seconds once it lands or waits to be sent, or "!" with the reason as the button's title
// until the next save. The check mark's clear takes back only a check mark, so a later save's
// "…" or "!" on the same tab is never wiped by an earlier one's.

import { browser } from "wxt/browser";

import type { Outcome } from "../messages";
import { outcomeLine } from "../outcome-copy";

const DEFAULT_TITLE = "Save to Inteligir";
const SAVED_SHOWN_MS = 2000;
const SAVING = "…";
const SAVED = "✓";

// a tab closed while its save ran has no badge to set, which is no failure of the save
const setBadge = async (tabId: number, text: string, title: string): Promise<void> => {
  try {
    await browser.action.setBadgeText({ tabId, text });
    await browser.action.setTitle({ tabId, title });
  } catch {
    // the tab is gone
  }
};

export const showSaving = async (tabId: number): Promise<void> => {
  await setBadge(tabId, SAVING, DEFAULT_TITLE);
};

const clearSaved = async (tabId: number): Promise<void> => {
  try {
    if ((await browser.action.getBadgeText({ tabId })) === SAVED) {
      await setBadge(tabId, "", DEFAULT_TITLE);
    }
  } catch {
    // the tab is gone
  }
};

export const showOutcome = async (tabId: number, outcome: Outcome): Promise<void> => {
  if (outcome.kind === "refused") {
    await setBadge(tabId, "!", outcomeLine(outcome).text);
    return;
  }
  await setBadge(tabId, SAVED, outcomeLine(outcome).text);
  setTimeout(() => {
    void clearSaved(tabId);
  }, SAVED_SHOWN_MS);
};
