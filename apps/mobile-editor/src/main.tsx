import { connectPageBridge, windowTransport } from "./bridge/page-bridge";
import { mountItemPage } from "./item/item-page";
import "./styles/globals.css";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the page has no #root to mount into");
}

// an IIFE build has no top-level await
void (async () => {
  const { bridge, init } = await connectPageBridge(windowTransport(window));
  mountItemPage({ bridge, container, itemId: init.itemId });
})();
