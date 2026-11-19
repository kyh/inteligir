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

const activeTabId = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  return tab?.id ?? null;
};

const opened = saveOpenedTab(activeTabId, askWorker);

createRoot(container).render(
  <StrictMode>
    <Popup ask={askWorker} opened={opened} />
  </StrictMode>,
);
