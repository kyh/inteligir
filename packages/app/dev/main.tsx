import { createRoot } from "react-dom/client";

import { App } from "@repo/app/app-root";
import { installBridge } from "@repo/app/lib/bridge";

import { createFixtureBridge } from "./fixture-bridge";

installBridge(createFixtureBridge());

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
