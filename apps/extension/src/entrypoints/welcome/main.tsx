// the page the extension opens once installed: it says hello to the Mac's native host and names
// the library it reached, or links the download (§8.6).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { askWorker } from "@/messages";
import "@/styles/globals.css";
import { Welcome } from "./app";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the welcome page has no #root to mount into");
}

createRoot(container).render(
  <StrictMode>
    <Welcome ask={askWorker} />
  </StrictMode>,
);
