// The library's page, in whichever host serves it. In the browser tab it opens the account's
// library (the session, then the replica), and with no session sends the browser to the site's
// sign-in, which brings it back here. In the Mac app it opens the library the shell keeps for the
// account it is signed in to, or the sign-in that is the app's first run. Either way, sign-in is
// the first run: there is nothing to choose before it.

import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";
import type { SessionEnd } from "@repo/library-replica/call-outcome";
import { onlineManager } from "@tanstack/react-query";
import { createBrowserHistory, createHashHistory, RouterProvider } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { createLeaveGuard, replicaHolds } from "./app/cloud/leave-guard";
import { openPageLibrary, signInHref } from "./app/cloud/page-library";
import type { PageLibrary, PageOpening } from "./app/cloud/page-library";
import { OpenFailedPage, TabOpenFailedPage } from "./app/cloud/open-failed-page";
import { createShellLeaveGuard, openShellLibrary } from "./app/cloud/shell-library";
import type { ShellOpening } from "./app/cloud/shell-library";
import { SignInPage } from "./app/cloud/sign-in-page";
import { createPageQueryClient } from "./app/cloud/v1";
import { installLightPrints } from "./app/light-prints";
import { applyStoredSpellcheck } from "./app/spellcheck";
import { createAppRouter } from "./router";
import type { PageBasepath } from "./router";
import { underShell } from "./shell/shell-commands";
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
const mount = (library: PageLibrary, history: RouterHistory, basepath: PageBasepath): void => {
  library.replica.start();
  onlineManager.subscribe((online) => {
    if (online) {
      library.replica.resume();
    }
  });
  const router = createAppRouter(
    history,
    { library, queryClient: createPageQueryClient() },
    basepath,
  );
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
        <TabOpenFailedPage
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
      mount(library, createBrowserHistory(), LIBRARY_PAGE_PATH);
      break;
    }
    // no default
  }
};

// the Mac's page opened again from the start: the library, or the sign-in once signed out
const reloadShellPage = (): void => {
  window.location.reload();
};

// the Mac's document never changes under it: its routes ride the hash, so a reload is the same file
const openInShell = async (target: Root): Promise<void> => {
  const leave = createShellLeaveGuard();
  let opening: ShellOpening;
  try {
    opening = await openShellLibrary(leave, reloadShellPage);
  } catch (error) {
    // nothing is drawn yet, so no boundary would catch it: the window says what failed instead
    target.render(
      <StrictMode>
        <OpenFailedPage
          cause={error}
          queryClient={createPageQueryClient()}
          reload={reloadShellPage}
        />
      </StrictMode>,
    );
    return;
  }
  switch (opening.kind) {
    case "signed-out": {
      target.render(
        <StrictMode>
          <SignInPage
            config={opening.config}
            queryClient={createPageQueryClient()}
            onSignedIn={reloadShellPage}
          />
        </StrictMode>,
      );
      break;
    }
    case "ready": {
      mount(opening.library, createHashHistory(), "/");
      break;
    }
    // no default
  }
};

await (underShell() ? openInShell(root) : openInTab(root));
