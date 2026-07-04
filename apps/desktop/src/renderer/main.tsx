import { createRoot } from "react-dom/client";

import { App } from "@renderer/app-root";
import { installBridge } from "@renderer/lib/bridge";

// The preload script exposes the IPC bridge on window before this module
// runs. Missing means preload failed to load — render the failure instead of
// a silently broken app.
const root = document.getElementById("root");
const bridge = window.desktopBridge;

if (root) {
  if (bridge) {
    installBridge(bridge);
    createRoot(root).render(<App />);
  } else {
    root.textContent =
      "Inteligir failed to start: the desktop bridge is missing (preload did not load). Please relaunch the app.";
  }
}
