// The worker's two doors for a message, each refusing every sender but its own and every message
// that does not parse before anything reaches storage or the cloud: the extension's own pages (the
// popup, the welcome page), which ask for a save, a status or a disconnect, and the one connect
// page the manifest names, which hands over a credential. A refused message is answered with
// nothing (the listener returns false); an accepted one is answered once its work is done, so the
// listener returns true to keep the channel open for it.

import { extensionConnectRequestSchema } from "@repo/contract/cloud/extension/extension-connect";
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";

import { extensionRequestSchema } from "../messages";
import type { ExtensionRequest, Outcome } from "../messages";
import type { ExtensionFlavor } from "../manifest";
import { answerConnectPage, connectPageOrigin } from "./connection";
import type { ConnectDeps } from "./connection";

// the extension's own pages, wherever they are open: a script it injects into a web page sends
// under the extension's id too, but carries that page's url
const fromOwnPages = (sender: Browser.runtime.MessageSender): boolean =>
  sender.id === browser.runtime.id && sender.url?.startsWith(browser.runtime.getURL("/")) === true;

// the browser's own listener types, so a listener here is registered as it is tested
type MessageListener = Parameters<typeof browser.runtime.onMessage.addListener>[0];
type ExternalListener = Parameters<typeof browser.runtime.onMessageExternal.addListener>[0];

export const ownPagesListener = (answer: (request: ExtensionRequest) => Promise<Outcome>) =>
  ((message, sender, sendResponse) => {
    if (!fromOwnPages(sender)) {
      return false;
    }
    const parsed = extensionRequestSchema.safeParse(message);
    if (!parsed.success) {
      return false;
    }
    void (async () => {
      sendResponse(await answer(parsed.data));
    })();
    return true;
  }) satisfies MessageListener;

export interface ConnectPageDeps extends ConnectDeps {
  // what follows a connect page's answer: a save made before the connection waits no longer
  readonly answered: () => Promise<void>;
}

// the one page the manifest names, checked again by its origin, and a message it parses
export const connectPageListener = (flavor: ExtensionFlavor, deps: ConnectPageDeps) =>
  ((message, sender, sendResponse) => {
    const origin = connectPageOrigin(flavor, sender);
    const parsed = extensionConnectRequestSchema.safeParse(message);
    if (origin === null || !parsed.success) {
      return false;
    }
    void (async () => {
      sendResponse(await answerConnectPage(parsed.data, origin, deps));
      await deps.answered();
    })();
    return true;
  }) satisfies ExternalListener;
