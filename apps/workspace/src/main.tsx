// The library's page, in a browser tab or the Mac app's window alike: it opens the account's
// library (the session, then the replica), and with no session sends the browser to the site's
// sign-in, which brings it back here. Sign-in is the first run: there is nothing to choose before it.

import type { SessionEnd } from "@repo/library-replica/call-outcome";
import { onlineManager } from "@tanstack/react-query";
import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { createLeaveGuard, replicaHolds } from "./app/cloud/leave-guard";
import { openPageLibrary, signInHref } from "./app/cloud/page-library";
import type { PageLibrary, PageOpening } from "./app/cloud/page-library";
import { OpenFailedPage } from "./app/cloud/open-failed-page";
import { createPageQueryClient } from "./app/cloud/v1";
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

// the library drawn: the replica running, catching up the moment the connection comes back
const mount = (library: PageLibrary): void => {
  library.replica.start();
  onlineManager.subscribe((online) => {
    if (online) {
      library.replica.resume();
    }
  });
  const router = createAppRouter(createBrowserHistory(), {
    library,
    queryClient: createPageQueryClient(),
  });
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
};

const openInTab = async (target: Root): Promise<void> => {
  const leave = createLeaveGuard(window);
  // a session that ended leaves nothing the tab could still send, so the browser does not ask
  const goSignIn = (): void => {
    leave.drop();
    window.location.assign(signInHref(window.location));
  };
  // the floor spares a page the Worker served by a header only a browser this old leaves out, and
  // the sign-in would send a tab it signed in straight back here
  const sessionEnded = (end: SessionEnd): void => {
    if (end === "outdated") {
      leave.drop();
      target.render(TOO_OLD);
      return;
    }
    goSignIn();
  };
  let opening: PageOpening;
  try {
    opening = await openPageLibrary(window.location.origin, { leave, onSessionEnd: sessionEnded });
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
  switch (opening.kind) {
    case "signed-out": {
      goSignIn();
      break;
    }
    case "unsupported": {
      target.render(TOO_OLD);
      break;
    }
    case "ready": {
      const { library } = opening;
      // CLAUDE.md § THE TAB SENDS WHAT IT HOLDS UNTIL IT CLOSES, AND ASKS BEFORE LOSING IT: the
      // replica keeps running out of sight, since what it has not sent lives only in this tab, and
      // the browser asks before the tab goes while any of it is held
      leave.hold({
        holding: () => replicaHolds(library.replica.status()),
        onMove: library.replica.onStatus,
      });
      mount(library);
      break;
    }
    // no default
  }
};

await openInTab(root);
