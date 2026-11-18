// the extension's service worker: the toolbar's and the right-click's saves to the library over
// `/v1`, under the browser's own sign-in to the site its build names, and what sends a save that
// waited: the alarm, a sign-in on the site and the worker's own start. It answers the extension's
// own pages, nothing else. Every listener is registered in main()'s first turn, as MV3 wants, and
// nothing it needs later is held in memory: the account and the queue are storage's, the session
// the browser's jar.

import { LIBRARY_PAGE_PATH, SIGN_IN_PATH } from "@repo/contract/library-page";
import { browser } from "wxt/browser";
import type { Browser, PublicPath } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import type { ExtensionRequest, HeldSaves, Outcome, Status, WorkerAnswer } from "../messages";
import { showOutcome, showSaving } from "../background/badge";
import { captureTab, fetchCover } from "../background/capture-tab";
import { cloudOf } from "../background/cloud";
import { cloudOrigin } from "../background/connection";
import { ownPagesListener } from "../background/listeners";
import { MENU_ITEMS, menuAction } from "../background/menus";
import type { MenuContext } from "../background/menus";
import { saveAddress, savePicture, saveTab } from "../background/save-page";
import type { SaveDeps, TabFacts } from "../background/save-page";
import {
  discardSave,
  heldSaves,
  retrySave,
  SEND_ALARM,
  sendQueued,
} from "../background/save-queue";
import type { SendDeps } from "../background/save-queue";
import { cloudSignIn, heldSignIn, saveSignIn, setsSession } from "../background/sign-in";
import type { Session } from "../background/sign-in";

// src/entrypoints/welcome, which WXT writes at this path
const WELCOME_PAGE = "/welcome.html" satisfies PublicPath;

// the cheapest extension API, which resets the worker's idle timer while a file uploads
const keepAwake = (): void => {
  void browser.runtime.getPlatformInfo();
};

const cloudFor = (session: Session) =>
  cloudOf(session, browser.runtime.getManifest().version, keepAwake);

const saveDeps: SaveDeps = {
  capture: captureTab,
  cloud: cloudFor,
  fetchCover,
  newBlockId: () => crypto.randomUUID(),
  now: () => Date.now(),
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  signIn: saveSignIn,
};

const sendDeps: SendDeps = { cloud: cloudFor, signIn: cloudSignIn };

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

// the cloud asked, and when it does not answer, what the browser holds
const status = async (): Promise<Status> => {
  const origin = await cloudOrigin();
  const signIn = (await cloudSignIn()) ?? (await heldSignIn());
  return {
    account:
      signIn.kind === "signed-in"
        ? { email: signIn.session.email, libraryUrl: `${origin}${LIBRARY_PAGE_PATH}` }
        : null,
    signInUrl: `${origin}${SIGN_IN_PATH}`,
  };
};

const NONE_HELD: HeldSaves = { refused: [], waiting: 0 };

// the saves the account signed in keeps, as the browser holds that sign-in, with no call: another
// account's wait unseen for that account
const held = async (): Promise<HeldSaves> => {
  const signIn = await heldSignIn();
  return signIn.kind === "signed-in" ? await heldSaves(signIn.session.email) : NONE_HELD;
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
    case "saves": {
      return await held();
    }
    case "retry": {
      await retrySave(request.opId);
      await sendQueued(sendDeps);
      return await held();
    }
    case "discard": {
      await discardSave(request.opId);
      return await held();
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
// what waits sent where no alarm stands to send it, since a restart or an update can clear one and
// brings what a save may have waited for
const starting = async (): Promise<void> => {
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const alarm = await browser.alarms.get(SEND_ALARM);
  if (alarm === undefined) {
    await sendQueued(sendDeps);
  }
};

// WXT imports this file at build time with main() emptied, so every browser call waits in it; the
// worker runs main() in its first turn, which is where MV3 wants its listeners
export default defineBackground({
  main() {
    // oxlint-disable-next-line typescript/strict-void-return -- a listener answers later by returning true, as the extension messaging docs say, which WXT's types declare void
    browser.runtime.onMessage.addListener(ownPagesListener(answer));
    browser.contextMenus.onClicked.addListener((info, tab) => {
      void clicked(info, tab);
    });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SEND_ALARM) {
        void sendQueued(sendDeps);
      }
    });
    // a save that waits for its account goes as the site signs it in
    browser.cookies.onChanged.addListener((change) => {
      if (setsSession(change)) {
        void sendQueued(sendDeps);
      }
    });
    browser.runtime.onInstalled.addListener((details) => {
      void installed(details.reason);
    });
    browser.runtime.onStartup.addListener(() => {
      // listened to only so the browser's start starts the worker, which a cleared alarm cannot:
      // `starting` sends what waits
    });
    void starting();
  },
  type: "module",
});
