import { createRoot } from "react-dom/client";

import { createWsBridge } from "@repo/bridge/ws-bridge";

import { App } from "@renderer/app-root";
import { installBridge } from "@renderer/lib/bridge";

// The preload script exposes the ws bootstrap (endpoint + per-boot token) on
// window before this module runs. Missing means preload failed to load —
// render the failure instead of a silently broken app. The bridge's reconnect
// supervisor owns the connection from here on.
const root = document.getElementById("root");
const bootstrap = window.bridgeBootstrap;

if (root) {
  if (bootstrap) {
    const reactRoot = createRoot(root);
    const { bridge } = createWsBridge({
      url: bootstrap.url,
      token: bootstrap.token,
      // "unauthorized" is terminal (the host rejected this window's per-boot
      // token and the supervisor has stopped), so a live UI would just hang —
      // replace it with the same failure surface as a missing bootstrap.
      onStatus: (status) => {
        if (status !== "unauthorized") return;
        reactRoot.unmount();
        root.textContent =
          "Inteligir failed to start: the host rejected this window's bridge token. Please relaunch the app.";
      },
    });
    installBridge(bridge);
    reactRoot.render(<App />);
  } else {
    root.textContent =
      "Inteligir failed to start: the bridge bootstrap is missing (preload did not load). Please relaunch the app.";
  }
}
