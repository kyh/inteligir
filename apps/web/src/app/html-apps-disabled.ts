import type { HtmlAppRuntime } from "@repo/workspace/workspace/html-app-host";

// ---------------------------------------------------------------------------
// HTML apps are OFF, and this is the refusal.
//
// The workspace opens a vault `.html` as an app in a `sandbox="allow-scripts
// allow-forms"` frame and hands it a postMessage broker that can `list()` and
// `read()` every doc in the vault. `allow-scripts` does not restrain `fetch`,
// and the injected runtime ships no CSP, so an app that reads the vault can
// also POST it anywhere. On one person's machine, running `.html` their own
// agent wrote, that was the accepted bargain. Hosted, "the agent wrote it after
// reading a note" is a live path — so the capability does not ship until the
// served document carries a `connect-src 'none'` CSP, which belongs with
// whatever serves it rather than after it.
//
// `injectRuntime` REFUSES rather than assembling the blob the view would
// otherwise load, and the refusal is a sentence the user can act on: the view's
// "Open as text" button is the way to read the file's source.
// ---------------------------------------------------------------------------

export const HTML_APPS_DISABLED: HtmlAppRuntime = {
  injectRuntime: () => {
    throw new Error("HTML apps aren't available yet — open this file as text to see its source.");
  },
};
