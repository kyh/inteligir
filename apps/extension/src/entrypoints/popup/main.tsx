// the toolbar's popup: it saves the active tab on open and says how that went.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";

import { askWorker } from "../../messages";
import "../../styles/globals.css";
import { Popup, saveOpenedTab } from "./app";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the popup has no #root to mount into");
}

// the tab the toolbar was clicked over: activeTab grants the worker that one alone
const activeTabId = async (): Promise<number | null> => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
};

// made here, once, and only read by React, which under StrictMode runs what it owns twice
const opened = saveOpenedTab(activeTabId, askWorker);

createRoot(container).render(
  <StrictMode>
    <Popup ask={askWorker} opened={opened} />
  </StrictMode>,
);
