// the toolbar's badge says how a save went on the tab it was made from: "…" while it runs, "✓"
// for two seconds once it lands or waits to be sent, or "!" with the reason as the button's title
// until the next save. Each save cancels the clear an earlier one left on its tab, so a later "…",
// "✓" or "!" is never wiped by it.

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

const pendingClears = new Map<number, ReturnType<typeof setTimeout>>();

const cancelClear = (tabId: number): void => {
  clearTimeout(pendingClears.get(tabId));
  pendingClears.delete(tabId);
};

export const showSaving = async (tabId: number): Promise<void> => {
  cancelClear(tabId);
  await setBadge(tabId, SAVING, DEFAULT_TITLE);
};

export const showOutcome = async (tabId: number, outcome: Outcome): Promise<void> => {
  cancelClear(tabId);
  if (outcome.kind === "refused") {
    await setBadge(tabId, "!", outcomeLine(outcome).text);
    return;
  }
  await setBadge(tabId, SAVED, outcomeLine(outcome).text);
  pendingClears.set(
    tabId,
    setTimeout(() => {
      pendingClears.delete(tabId);
      void setBadge(tabId, "", DEFAULT_TITLE);
    }, SAVED_SHOWN_MS),
  );
};
