// the extension's service worker: the toolbar's and the right-click's saves to the library over
// `/v1`, the site's connect page handing it a credential, and the alarm that sends what waited.
// It answers the extension's own pages and the one connect page its manifest names, nothing else.
// Every listener is registered in main()'s first turn, as MV3 wants, and nothing it needs later is
// held in memory: the connection and the queue are storage's.

import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";
import {
  CONNECT_EXTENSION_PATH,
  extensionConnectRequestSchema,
} from "@repo/contract/cloud/extension/extension-connect";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";
import { browser } from "wxt/browser";
import type { Browser, PublicPath } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import { extensionRequestSchema } from "../messages";
import type { ExtensionRequest, Outcome } from "../messages";
import { DEV_CLOUD_ORIGIN, flavorOfMode } from "../manifest";
import { showOutcome, showSaving } from "../background/badge";
import { captureTab, fetchCover } from "../background/capture-tab";
import { cloudOf } from "../background/cloud";
import {
  answerConnectPage,
  connectPageOrigin,
  forgetConnection,
  readConnection,
} from "../background/connection";
import type { Connection } from "../background/connection";
import { MENU_ITEMS, menuAction } from "../background/menus";
import type { MenuContext } from "../background/menus";
import { saveAddress, savePicture, saveTab } from "../background/save-page";
import type { SaveDeps, TabFacts } from "../background/save-page";
import { ensureSendAlarm, forgetQueue, SEND_ALARM, sendQueued } from "../background/save-queue";

// src/entrypoints/welcome, which WXT writes at this path
const WELCOME_PAGE = "/welcome.html" satisfies PublicPath;

const cloudFor = (connection: Connection) =>
  cloudOf(connection, browser.runtime.getManifest().version);

// the credential is no longer the account's: the extension forgets it and what waited under it
const signedOut = async (): Promise<void> => {
  await forgetQueue();
  await forgetConnection();
  await ensureSendAlarm();
};

const saveDeps: SaveDeps = {
  capture: captureTab,
  cloud: cloudFor,
  connection: readConnection,
  fetchCover,
  newBlockId: () => crypto.randomUUID(),
  now: () => Date.now(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  signedOut,
};

const sendDeps = {
  cloud: cloudFor,
  connection: readConnection,
  now: () => Date.now(),
  signedOut,
};

// the cloud this build connects to before it holds a connection: the production site, or for the
// dev build the local Worker `pnpm dev:web` serves. The mode is a literal in the bundle, so a store
// build carries no checkout's origin (the zip's check in wxt.config.ts)
const FIRST_CLOUD_ORIGIN =
  import.meta.env.MODE === "store" ? PRODUCTION_CLOUD_ORIGIN : DEV_CLOUD_ORIGIN;

const connectUrl = (connection: Connection | null): string =>
  `${connection?.origin ?? FIRST_CLOUD_ORIGIN}${CONNECT_EXTENSION_PATH}`;

const tabFacts = (tab: Browser.tabs.Tab): TabFacts | null =>
  tab.id === undefined ? null : { id: tab.id, title: tab.title, url: tab.url };

// every save shows on the toolbar of the tab it came from, and one that landed sends what waited,
// since the cloud answers again
const withBadge = async (tabId: number, run: () => Promise<Outcome>): Promise<Outcome> => {
  await showSaving(tabId);
  const outcome = await run();
  await showOutcome(tabId, outcome);
  if (outcome.kind === "saved") {
    void sendQueued(sendDeps);
  }
  return outcome;
};

const status = async (): Promise<Outcome> => {
  const connection = await readConnection();
  return {
    connectUrl: connectUrl(connection),
    connection:
      connection === null
        ? null
        : { email: connection.email, libraryUrl: `${connection.origin}${LIBRARY_PAGE_PATH}` },
    kind: "status",
  };
};

const revokeQuietly = async (connection: Connection): Promise<void> => {
  try {
    await cloudFor(connection).signOut();
  } catch {
    // a revoke the cloud did not take leaves a device the devices page can revoke
  }
};

const answer = async (request: ExtensionRequest): Promise<Outcome> => {
  switch (request.type) {
    case "save": {
      let tab: Browser.tabs.Tab;
      try {
        tab = await browser.tabs.get(request.tabId);
      } catch {
        return { kind: "refused", reason: "unsupported-page" };
      }
      const facts = tabFacts(tab);
      if (facts === null) {
        return { kind: "refused", reason: "unsupported-page" };
      }
      return await withBadge(facts.id, async () => await saveTab(saveDeps, { tab: facts }));
    }
    case "status": {
      return await status();
    }
    case "disconnect": {
      const connection = await readConnection();
      await signedOut();
      // best effort, never waited on by what the page shows
      if (connection !== null) {
        void revokeQuietly(connection);
      }
      return await status();
    }
    // no default
  }
};

// the extension's own pages, wherever they are open; a script in a web page carries that page's url
const fromOwnPages = (sender: Browser.runtime.MessageSender): boolean =>
  sender.id === browser.runtime.id && sender.url?.startsWith(browser.runtime.getURL("/")) === true;

const clicked = async (info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) => {
  const facts = tab === undefined ? null : tabFacts(tab);
  if (facts === null) {
    return;
  }
  const action = menuAction(info);
  await withBadge(facts.id, async () => {
    switch (action.kind) {
      case "page": {
        return await saveTab(saveDeps, { tab: facts });
      }
      case "selection": {
        return await saveTab(saveDeps, { selectionText: action.text, tab: facts });
      }
      case "address": {
        return await saveAddress(saveDeps, action.url);
      }
      case "picture": {
        return await savePicture(saveDeps, { bytes: action.bytes, pageUrl: facts.url ?? "" });
      }
      case "unsupported": {
        return { kind: "refused", reason: "unsupported-page" };
      }
      // no default
    }
  });
};

// the browser's own enum, read only once the worker runs in the browser
const contextType = (context: MenuContext): Browser.contextMenus.ContextType => {
  switch (context) {
    case "page": {
      return browser.contextMenus.ContextType.PAGE;
    }
    case "link": {
      return browser.contextMenus.ContextType.LINK;
    }
    case "image": {
      return browser.contextMenus.ContextType.IMAGE;
    }
    case "selection": {
      return browser.contextMenus.ContextType.SELECTION;
    }
    // no default
  }
};

const installed = async (reason: string): Promise<void> => {
  // an update keeps the menus an earlier version made, whose ids a second create would refuse
  await browser.contextMenus.removeAll();
  for (const item of MENU_ITEMS) {
    browser.contextMenus.create({
      contexts: [contextType(item.context)],
      id: item.id,
      title: item.title,
    });
  }
  if (reason === "install") {
    await browser.tabs.create({ url: browser.runtime.getURL(WELCOME_PAGE) });
  }
};

// every start: the credential and the queue kept from the capture script WXT injects, and the
// alarm made again while a save waits, since an update or a restart can clear it
const starting = async (): Promise<void> => {
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await ensureSendAlarm();
};

// WXT imports this file at build time with main() emptied, so every browser call waits in it; the
// worker runs main() in its first turn, which is where MV3 wants its listeners
export default defineBackground({
  main() {
    const flavor = flavorOfMode(import.meta.env.MODE);
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    // the one page the manifest names, checked again by its origin, and a message it parses
    browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
      const origin = connectPageOrigin(flavor, sender);
      const parsed = extensionConnectRequestSchema.safeParse(message);
      if (origin === null || !parsed.success) {
        return false;
      }
      void (async () => {
        sendResponse(
          await answerConnectPage(parsed.data, origin, {
            revoke: async (connection) => {
              await cloudFor(connection).signOut();
            },
          }),
        );
        // a save made before the connection waits no longer than this
        await sendQueued(sendDeps);
      })();
      return true;
    });
    browser.contextMenus.onClicked.addListener((info, tab) => {
      void clicked(info, tab);
    });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SEND_ALARM) {
        void sendQueued(sendDeps);
      }
    });
    browser.runtime.onInstalled.addListener((details) => {
      void installed(details.reason);
    });
    void starting();
  },
  type: "module",
});
