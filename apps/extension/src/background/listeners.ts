// The worker's one door for a message: the extension's own pages (the popup, the welcome page),
// which ask for a save or a status. Every other sender and every message that does not parse is
// refused before anything reaches storage or the cloud, and no web page has a door at all. A
// refused message is answered with nothing (the listener returns false); an accepted one is
// answered once its work is done, so the listener returns true to keep the channel open for it,
// and a work that failed (a storage fault) is answered too, as a failure, so no page waits on an
// answer that never comes.

import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";

import { extensionRequestSchema } from "../messages";
import type { ExtensionRequest, WorkerAnswer } from "../messages";

// the extension's own pages, wherever they are open: a script it injects into a web page sends
// under the extension's id too, but carries that page's url
const fromOwnPages = (sender: Browser.runtime.MessageSender): boolean =>
  sender.id === browser.runtime.id && sender.url?.startsWith(browser.runtime.getURL("/")) === true;

// the browser's own listener type, so the listener here is registered as it is tested
type MessageListener = Parameters<typeof browser.runtime.onMessage.addListener>[0];

export const ownPagesListener = (answer: (request: ExtensionRequest) => Promise<WorkerAnswer>) =>
  ((message, sender, sendResponse) => {
    if (!fromOwnPages(sender)) {
      return false;
    }
    const parsed = extensionRequestSchema.safeParse(message);
    if (!parsed.success) {
      return false;
    }
    void (async () => {
      let reply: WorkerAnswer;
      try {
        reply = await answer(parsed.data);
      } catch {
        reply = { kind: "refused", reason: "failed" };
      }
      sendResponse(reply);
    })();
    return true;
  }) satisfies MessageListener;
