// The library's page: it opens the account's library (the session, then the replica), and with
// no session sends the browser to the site's sign-in, which brings it back here. Sign-in is the
// first run: there is nothing to choose before it.

import { onlineManager } from "@tanstack/react-query";
import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { openPageLibrary, signInHref } from "./app/cloud/page-library";
import { createPageQueryClient } from "./app/cloud/v1";
import { installLightPrints } from "./app/light-prints";
import { applyStoredSpellcheck } from "./app/spellcheck";
import { createAppRouter } from "./router";
import "./styles/globals.css";

// before the first paint: a stored "off" must not flash red underlines
applyStoredSpellcheck();
installLightPrints();

const goSignIn = (): void => {
  window.location.assign(signInHref(window.location));
};

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("the document has no #root to mount into");
}

const opening = await openPageLibrary(window.location.origin, goSignIn);
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
    // the socket and the minute's check-in rest while the tab is out of sight, and a tab in sight
    // catches up the moment its connection comes back rather than at its next retry
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        library.replica.resume();
      } else {
        library.replica.suspend();
      }
    });
    onlineManager.subscribe((online) => {
      if (online && document.visibilityState === "visible") {
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
