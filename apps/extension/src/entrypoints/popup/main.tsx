// the toolbar's popup: it saves the active tab on open and says where it landed (§8.6).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { askWorker } from "@/messages";
import "@/styles/globals.css";
import { Popup } from "./app";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the popup has no #root to mount into");
}

// the tab the toolbar was clicked over: activeTab grants the worker that one alone
const activeTabId = async (): Promise<number | null> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
};

createRoot(container).render(
  <StrictMode>
    <Popup activeTabId={activeTabId} ask={askWorker} />
  </StrictMode>,
);
