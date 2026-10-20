import { connectPageBridge, windowTransport } from "./bridge/page-bridge";
import { mountEditorPage } from "./editor-page";
import { serveFills } from "./fill/serve-fills";
import "./styles/globals.css";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the page has no #root to mount into");
}

// an IIFE build has no top-level await
void (async () => {
  const { bridge, init } = await connectPageBridge(windowTransport(window));
  if (init.mode === "fill") {
    serveFills(bridge);
    return;
  }
  mountEditorPage({ bridge, container, init });
})();
