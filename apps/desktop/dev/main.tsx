import { createRoot } from "react-dom/client";

import { App } from "@renderer/app-root";
import { installBridge } from "@renderer/lib/bridge";

import { createFixtureBridge } from "./fixture-bridge";

installBridge(createFixtureBridge());

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
