import { browser } from "wxt/browser";

import type { Outcome } from "../messages";
import { outcomeLine } from "../outcome-copy";

const DEFAULT_TITLE = "Save to Inteligir";
const SAVED_SHOWN_MS = 2000;
const SAVING = "…";
const SAVED = "✓";

const setBadge = async (tabId: number, text: string, title: string) => {
  await Promise.allSettled([
    (async () => {
      await browser.action.setBadgeText({ tabId, text });
      await browser.action.setTitle({ tabId, title });
    })(),
  ]);
};

const pendingClears = new Map<number, ReturnType<typeof setTimeout>>();

const cancelClear = (tabId: number) => {
  clearTimeout(pendingClears.get(tabId));
  pendingClears.delete(tabId);
};

export const showSaving = async (tabId: number) => {
  cancelClear(tabId);
  await setBadge(tabId, SAVING, DEFAULT_TITLE);
};

export const showOutcome = async (tabId: number, outcome: Outcome) => {
  cancelClear(tabId);
  const line = outcomeLine(outcome);

  if (outcome.kind === "refused" || line.signIn) {
    await setBadge(tabId, "!", line.text);

    return;
  }

  await setBadge(tabId, SAVED, line.text);
  pendingClears.set(
    tabId,
    setTimeout(() => {
      pendingClears.delete(tabId);
      void setBadge(tabId, "", DEFAULT_TITLE);
    }, SAVED_SHOWN_MS),
  );
};
