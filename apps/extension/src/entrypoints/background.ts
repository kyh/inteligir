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

const WELCOME_PAGE = "/welcome.html" satisfies PublicPath;

const keepAwake = () => {
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

const tabFacts = (tab: Browser.tabs.Tab) =>
  (tab.id === undefined
    ? null
    : { id: tab.id, title: tab.title, url: tab.url }) satisfies TabFacts | null;

const withBadge = async (tabId: number, run: () => Promise<Outcome>) => {
  await showSaving(tabId);
  const outcome = await run();
  await showOutcome(tabId, outcome);

  if (outcome.kind === "saved") {
    void sendQueued(sendDeps);
  }

  return outcome;
};

const status = async () => {
  const origin = await cloudOrigin();
  const signIn = (await cloudSignIn()) ?? (await heldSignIn());

  return {
    account:
      signIn.kind === "signed-in"
        ? { email: signIn.session.email, libraryUrl: `${origin}${LIBRARY_PAGE_PATH}` }
        : null,
    signInUrl: `${origin}${SIGN_IN_PATH}`,
  } satisfies Status;
};

const NONE_HELD: HeldSaves = { refused: [], waiting: 0 };

const held = async () => {
  const signIn = await heldSignIn();

  return signIn.kind === "signed-in" ? await heldSaves(signIn.session.email) : NONE_HELD;
};

const answer = async (request: ExtensionRequest) => {
  switch (request.type) {
    case "save": {
      let tab: Browser.tabs.Tab;

      try {
        tab = await browser.tabs.get(request.tabId);
      } catch {
        return { kind: "refused", reason: "unsupported-page" } satisfies WorkerAnswer;
      }

      const facts = tabFacts(tab);

      if (facts === null) {
        return { kind: "refused", reason: "unsupported-page" } satisfies WorkerAnswer;
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

    default: {
      throw new Error(`unexpected ${String(request satisfies never)}`);
    }
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

      default: {
        throw new Error(`unexpected ${String(action satisfies never)}`);
      }
    }
  });
};

const contextType = (context: MenuContext) => {
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

    default: {
      throw new Error(`unexpected ${String(context satisfies never)}`);
    }
  }
};

const installed = async (reason: string) => {
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

const starting = async () => {
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const alarm = await browser.alarms.get(SEND_ALARM);

  if (alarm === undefined) {
    await sendQueued(sendDeps);
  }
};

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
    browser.cookies.onChanged.addListener((change) => {
      if (setsSession(change)) {
        void sendQueued(sendDeps);
      }
    });
    browser.runtime.onInstalled.addListener((details) => {
      void installed(details.reason);
    });
    // oxlint-disable-next-line no-empty-function -- a listener is what wakes the worker at browser start
    browser.runtime.onStartup.addListener(() => {});
    void starting();
  },
  type: "module",
});
