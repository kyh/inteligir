import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";

import { extensionRequestSchema } from "../messages";
import type { ExtensionRequest, WorkerAnswer } from "../messages";

const fromOwnPages = (sender: Browser.runtime.MessageSender) =>
  sender.id === browser.runtime.id && sender.url?.startsWith(browser.runtime.getURL("/")) === true;

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
