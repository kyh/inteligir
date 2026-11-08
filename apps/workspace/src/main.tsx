// The library's page, in a browser tab or the Mac app's window alike: it reads the session the
// site's sign-in left and draws the account's library over the cell, and with no session sends the
// browser to the site's sign-in, which brings it back here. Sign-in is the first run: there is
// nothing to choose before it.

import type { SessionEnd, V1Transport } from "@repo/contract/cloud/library/call-outcome";
import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { claimAccountStorage, forgetAccountStorage } from "./app/cloud/account-storage";
import { createLeaveGuard } from "./app/cloud/leave-guard";
import { OpenFailedPage } from "./app/cloud/open-failed-page";
import { pageClock } from "./app/cloud/page-clock";
import { readSession, SIGN_IN_PATH, signInHref } from "./app/cloud/page-session";
import { keepSession } from "./app/cloud/session-keeper";
import { createLibrarySocket } from "./app/cloud/use-library-socket";
import { createCloudWire, createPageQueryClient } from "./app/cloud/v1";
import { installLightPrints } from "./app/light-prints";
import { applyStoredSpellcheck } from "./app/spellcheck";
import { createAppRouter } from "./router";
import "./styles/globals.css";

// before the first paint: a stored "off" must not flash red underlines
applyStoredSpellcheck();
installLightPrints();

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the document has no #root to mount into");
}
const root = createRoot(container);

const TOO_OLD =
  "This browser is too old to open your library. Update it, or open the library in another browser.";

const openInTab = async (target: Root): Promise<void> => {
  const { origin } = window.location;
  const leave = createLeaveGuard(window);
  // a session that ended leaves nothing the tab could still send, so the browser does not ask
  const goSignIn = (): void => {
    leave.drop();
    window.location.assign(signInHref(window.location));
  };
  let account: Awaited<ReturnType<typeof readSession>>;
  try {
    account = await readSession(origin);
  } catch {
    // nothing is drawn yet, so no boundary would catch it: the tab says it didn't open instead
    target.render(
      <StrictMode>
        <OpenFailedPage
          reload={() => {
            window.location.reload();
          }}
        />
      </StrictMode>,
    );
    return;
  }
  if (account === null) {
    // a session ends with no tab open too, so nothing else saw it go
    forgetAccountStorage();
    goSignIn();
    return;
  }
  claimAccountStorage(account.id);
  keepSession(pageClock, async () => {
    await readSession(origin);
  });
  // the floor spares a page the Worker served by a header only a browser this old leaves out, and
  // the sign-in would send a tab it signed in straight back here, so that tab keeps its session
  const sessionEnded = (end: SessionEnd): void => {
    if (end === "outdated") {
      leave.drop();
      target.render(TOO_OLD);
      return;
    }
    forgetAccountStorage();
    goSignIn();
  };
  const cloud: V1Transport = { fetch: async (request) => await fetch(request), origin };
  const wire = createCloudWire(cloud, sessionEnded);
  const queryClient = createPageQueryClient();
  const socket = createLibrarySocket({
    clock: pageClock,
    dial: (url) => new WebSocket(url),
    origin,
    queryClient,
    wire,
  });
  const library = {
    account,
    cloud,
    leave,
    left: (reason: "signed-out" | "deleted") => {
      forgetAccountStorage();
      leave.drop();
      window.location.assign(reason === "deleted" ? "/" : SIGN_IN_PATH);
    },
    socket,
    wire,
  };
  target.render(
    <StrictMode>
      <RouterProvider router={createAppRouter(createBrowserHistory(), { library, queryClient })} />
    </StrictMode>,
  );
};

await openInTab(root);
