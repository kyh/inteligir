// The library's page: it opens the account's library (the session, then the replica), and with
// no session sends the browser to the site's sign-in, which brings it back here. Sign-in is the
// first run: there is nothing to choose before it.

import { onlineManager } from "@tanstack/react-query";
import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createLeaveGuard, replicaHolds } from "./app/cloud/leave-guard";
import { openPageLibrary, signInHref } from "./app/cloud/page-library";
import { createPageQueryClient } from "./app/cloud/v1";
import { installLightPrints } from "./app/light-prints";
import { applyStoredSpellcheck } from "./app/spellcheck";
import { createAppRouter } from "./router";
import "./styles/globals.css";

// before the first paint: a stored "off" must not flash red underlines
applyStoredSpellcheck();
installLightPrints();

const leave = createLeaveGuard(window);

// a session that ended leaves nothing the tab could still send, so the browser does not ask
const goSignIn = (): void => {
  leave.drop();
  window.location.assign(signInHref(window.location));
};

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the document has no #root to mount into");
}

const opening = await openPageLibrary(window.location.origin, { leave, onSessionEnd: goSignIn });
switch (opening.kind) {
  case "signed-out": {
    goSignIn();
    break;
  }
  case "unsupported": {
    container.textContent =
      "This browser is too old to open your library. Update it, or open the library in another browser.";
    break;
  }
  case "ready": {
    const { library } = opening;
    library.replica.start();
    // CLAUDE.md § THE TAB SENDS WHAT IT HOLDS UNTIL IT CLOSES, AND ASKS BEFORE LOSING IT: the
    // replica keeps running out of sight, since what it has not sent lives only in this tab, and
    // the browser asks before the tab goes while any of it is held
    leave.hold(() => replicaHolds(library.replica.status()), library.replica.onStatus);
    // a tab catches up the moment its connection comes back, rather than at its next retry
    onlineManager.subscribe((online) => {
      if (online) {
        library.replica.resume();
      }
    });
    const router = createAppRouter(createBrowserHistory(), {
      library,
      queryClient: createPageQueryClient(),
    });
    createRoot(container).render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    break;
  }
  // no default
}
