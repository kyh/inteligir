import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, setBridge } from "@repo/app";
import "@repo/app/styles.css";

// The preload script exposes the IPC-backed bridge on window; hand it to the
// app's Bridge singleton before first render so the UI and its stores can
// reach the main process.
if (window.desktopBridge) {
  setBridge(window.desktopBridge);
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
