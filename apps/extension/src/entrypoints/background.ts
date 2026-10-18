// the extension's service worker: the context menus, the toolbar's save, and one connectNative per
// request to the Mac's native host (§8.6). It answers only the extension's own pages, and there is
// no `externally_connectable`, so no web page can ask it anything.

import { BROWSER_WIRE_VERSION } from "@repo/contract/browser/browser-wire";
import type { PublicPath } from "wxt/browser";
import { extensionRequestSchema, refusedOutcome } from "@/messages";
import type { Outcome, ParsedExtensionRequest } from "@/messages";
import { askHost } from "@/background/ask-host";
import { showOutcome, showSaving } from "@/background/badge";
import { MENU_ITEMS, menuAction } from "@/background/menus";
import type { MenuContext } from "@/background/menus";
import { outcomeOf, saveTab, saveWith } from "@/background/save-tab";
import type { TabFacts } from "@/background/save-tab";

// src/entrypoints/welcome, which WXT writes at this path
const WELCOME_PAGE = "/welcome.html" satisfies PublicPath;

const tabFacts = (tab: chrome.tabs.Tab): TabFacts | null =>
  tab.id === undefined ? null : { id: tab.id, title: tab.title, url: tab.url };

// every save shows on the toolbar of the tab it came from
const withBadge = async (tabId: number, run: () => Promise<Outcome>): Promise<Outcome> => {
  await showSaving(tabId);
  const outcome = await run();
  await showOutcome(tabId, outcome);
  return outcome;
};

const GONE = refusedOutcome("unsupported-page", "that tab is no longer open");

const answer = async (request: ParsedExtensionRequest): Promise<Outcome> => {
  switch (request.type) {
    case "save": {
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.get(request.tabId);
      } catch {
        return GONE;
      }
      const facts = tabFacts(tab);
      if (facts === null) {
        return GONE;
      }
      return await withBadge(facts.id, () => saveTab({ keepCopy: request.keepCopy, tab: facts }));
    }
    case "hello": {
      return outcomeOf(await askHost({ type: "hello", v: BROWSER_WIRE_VERSION }));
    }
    case "open-app": {
      return outcomeOf(await askHost({ type: "open-app", v: BROWSER_WIRE_VERSION }));
    }
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
};

// the extension's own pages, wherever they are open; a script in a web page carries that page's url
const fromOwnPages = (sender: chrome.runtime.MessageSender): boolean =>
  sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL("")) === true;

const clicked = async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  const facts = tab === undefined ? null : tabFacts(tab);
  if (facts === null) {
    return;
  }
  const action = menuAction(info);
  await withBadge(facts.id, async () => {
    switch (action.kind) {
      case "page": {
        return await saveTab({ keepCopy: false, tab: facts });
      }
      case "selection": {
        return await saveTab({ keepCopy: false, selectionText: action.text, tab: facts });
      }
      case "save": {
        return await saveWith(action.save);
      }
      case "unsupported": {
        return refusedOutcome("unsupported-page", "only something on the web can be saved");
      }
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  });
};

// Chrome's own enum, read only once the worker runs in Chrome
const contextType = (context: MenuContext): chrome.contextMenus.ContextType => {
  switch (context) {
    case "page": {
      return chrome.contextMenus.ContextType.PAGE;
    }
    case "link": {
      return chrome.contextMenus.ContextType.LINK;
    }
    case "image": {
      return chrome.contextMenus.ContextType.IMAGE;
    }
    case "selection": {
      return chrome.contextMenus.ContextType.SELECTION;
    }
    default: {
      const exhaustive: never = context;
      return exhaustive;
    }
  }
};

const installed = async (reason: string): Promise<void> => {
  // an update keeps the menus an earlier version made, whose ids a second create would refuse
  await chrome.contextMenus.removeAll();
  for (const item of MENU_ITEMS) {
    chrome.contextMenus.create({
      contexts: [contextType(item.context)],
      id: item.id,
      title: item.title,
    });
  }
  if (reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) });
  }
};

// WXT imports this file at build time with main() emptied, so every chrome call waits in it; the
// worker runs main() in its first turn, which is where MV3 wants its listeners
export default defineBackground({
  main() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      // the answer comes later, so the channel stays open for it
      return true;
    });
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      void clicked(info, tab);
    });
    chrome.runtime.onInstalled.addListener((details) => {
      void installed(details.reason);
    });
  },
  type: "module",
});
