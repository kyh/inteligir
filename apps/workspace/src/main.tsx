import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installLightPrints } from "./app/note/export-pdf";
import { applyStoredSpellcheck } from "./app/spellcheck";
import { createAppRouter } from "./router";
import "./styles/globals.css";

// before the first paint: a stored "off" must not flash red underlines
applyStoredSpellcheck();
installLightPrints();

const router = createAppRouter(createBrowserHistory());

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the document has no #root to mount into");
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
