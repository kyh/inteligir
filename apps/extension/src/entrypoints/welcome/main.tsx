// the page the extension opens once installed: whose library it saves to, or how to connect one.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { askWorker } from "../../messages";
import "../../styles/globals.css";
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
