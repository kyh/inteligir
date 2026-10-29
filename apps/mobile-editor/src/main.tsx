import { connectPageBridge, windowTransport } from "./bridge/page-bridge";
import { mountEditorPage } from "./editor-page";
import { serveFills } from "./fill/serve-fills";
import { mountItemPage } from "./item/item-page";
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
  if (init.mode === "item") {
    mountItemPage({ bridge, container, init });
    return;
  }
  mountEditorPage({ bridge, container, init });
})();
