import type { HtmlAppRuntime } from "@repo/workspace/workspace/html-app-host";

// ---------------------------------------------------------------------------
// HTML apps are OFF on the web, and this is the refusal.
//
// The workspace opens a vault `.html` as an app in a `sandbox="allow-scripts
// allow-forms"` frame and hands it a postMessage broker that can `list()` and
// `read()` every doc in the vault. `allow-scripts` does not restrain `fetch`,
// and the injected runtime ships no CSP, so an app that reads the vault can
// also POST it anywhere. On one person's machine, running `.html` their own
// agent wrote, that is the accepted bargain. Hosted, "the agent wrote it after
// reading a note" is a live path — so the capability does not ship until the
// served document carries a `connect-src 'none'` CSP, which belongs with the
// route that serves it rather than after it.
//
// `protocolUrl: null` because there is no `vault-app://` scheme in a browser;
// `injectRuntime` REFUSES rather than assembling the blob the fallback would
// otherwise load. Nothing reaches it today — `mintHtmlAppToken` is a
// desktop-shell method this host does not register, so the view fails one step
// earlier — and that is exactly why the refusal is written down: the seam must
// not become a working exfiltration path the day that method is registered.
// ---------------------------------------------------------------------------

export const HTML_APPS_DISABLED: HtmlAppRuntime = {
  protocolUrl: null,
  injectRuntime: () => {
    throw new Error(
      "HTML apps aren't available on the web yet — open this file as text to see its source.",
    );
  },
};
