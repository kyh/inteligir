// the extension's service worker: the toolbar's and the right-click's saves to the library over
// `/v1`, under the browser's own sign-in to the site, which the connect page points it at, and the
// alarm that sends what waited. It answers the extension's own pages and the one connect page its
// manifest names, nothing else. Every listener is registered in main()'s first turn, as MV3 wants,
// and nothing it needs later is held in memory: the account and the queue are storage's, the
// session the browser's jar.

import { LIBRARY_PAGE_PATH, SIGN_IN_PATH } from "@repo/contract/library-page";
import { CONNECT_EXTENSION_PATH } from "@repo/contract/extension/extension-connect";
import { browser } from "wxt/browser";
import type { Browser, PublicPath } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import type { ExtensionRequest, Outcome, Status, WorkerAnswer } from "../messages";
import { flavorOfMode } from "../manifest";
import { showOutcome, showSaving } from "../background/badge";
import { captureTab, fetchCover } from "../background/capture-tab";
import { cloudOf } from "../background/cloud";
import { cloudOrigin, readConnection } from "../background/connection";
import { connectPageListener, ownPagesListener } from "../background/listeners";
import { MENU_ITEMS, menuAction } from "../background/menus";
import type { MenuContext } from "../background/menus";
import { saveAddress, savePicture, saveTab } from "../background/save-page";
import type { SaveDeps, TabFacts } from "../background/save-page";
import { ensureSendAlarm, SEND_ALARM, sendQueued } from "../background/save-queue";
import type { SendDeps } from "../background/save-queue";
import { askedSignIn, cloudSignIn, heldSignIn, saveSignIn } from "../background/sign-in";
import type { Session } from "../background/sign-in";

// src/entrypoints/welcome, which WXT writes at this path
const WELCOME_PAGE = "/welcome.html" satisfies PublicPath;

const cloudFor = (session: Session) => cloudOf(session, browser.runtime.getManifest().version);

const saveDeps: SaveDeps = {
  capture: captureTab,
  cloud: cloudFor,
  fetchCover,
  newBlockId: () => crypto.randomUUID(),
  now: () => Date.now(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  signIn: saveSignIn,
};

const sendDeps: SendDeps = {
  cloud: cloudFor,
  now: () => Date.now(),
  signIn: cloudSignIn,
};

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

// a store build saves to the site, so the site's own sign-in serves it; a dev build's connect page
// names the local Worker it saves to
const signInPath = (): string =>
  flavorOfMode(import.meta.env.MODE) === "store" ? SIGN_IN_PATH : CONNECT_EXTENSION_PATH;

// the cloud asked, and when it does not answer, what the browser holds
const status = async (): Promise<Status> => {
  const origin = cloudOrigin(await readConnection());
  const signIn = (await cloudSignIn()) ?? (await heldSignIn());
  return {
    account:
      signIn.kind === "signed-in"
        ? {
            email: signIn.session.email,
            libraryUrl: `${signIn.session.origin}${LIBRARY_PAGE_PATH}`,
          }
        : null,
    signInUrl: `${origin}${signInPath()}`,
  };
};

const answer = async (request: ExtensionRequest): Promise<WorkerAnswer> => {
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
    // no default
  }
};

const clicked = async (info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) => {
  const facts = tab === undefined ? null : tabFacts(tab);
  if (facts === null) {
    return;
  }
  const action = await menuAction(info);
  await withBadge(facts.id, async () => {
    switch (action.kind) {
      case "page": {
        return await saveTab(saveDeps, { tab: facts });
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

// every start: the account and the queue kept from the capture script the worker injects, and
// the alarm made again while a save waits, since an update or a restart can clear it
const starting = async (): Promise<void> => {
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await ensureSendAlarm();
};

// WXT imports this file at build time with main() emptied, so every browser call waits in it; the
// worker runs main() in its first turn, which is where MV3 wants its listeners
export default defineBackground({
  main() {
    // oxlint-disable-next-line typescript/strict-void-return -- a listener answers later by returning true, as the extension messaging docs say, which WXT's types declare void
    browser.runtime.onMessage.addListener(ownPagesListener(answer));
    browser.runtime.onMessageExternal.addListener(
      // oxlint-disable-next-line typescript/strict-void-return -- as above: it returns true to answer later
      connectPageListener(flavorOfMode(import.meta.env.MODE), {
        answered: async () => {
          await sendQueued(sendDeps);
        },
        signIn: askedSignIn,
      }),
    );
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
    // the one event that wakes the worker as the browser starts, which a cleared alarm cannot
    browser.runtime.onStartup.addListener(() => {
      void sendQueued(sendDeps);
    });
    void starting();
  },
  type: "module",
});
