// ---------------------------------------------------------------------------
// What serving a vault `.html` app needs from whichever host mounted the
// workspace. Injected rather than imported: Electron serves the app over its
// confined `vault-app://` protocol and weaves the vendored deps in at protocol
// level, while a plain browser has no protocol and must assemble a `blob:` URL
// with the same injection applied here. Neither is reachable from a package
// that must not know which host it runs under.
// ---------------------------------------------------------------------------

export type HtmlAppRuntime = {
  /** A confined URL that re-serves fresh bytes on every load, or `null` when
   * the host serves no protocol and the view falls back to an injected blob. */
  protocolUrl: ((path: string, token: string) => string) | null;
  /** Weave the vendored host deps + the postMessage broker runtime into an
   * app's HTML. The injected-deps set is an append-only contract with every
   * app an agent has ever written. */
  injectRuntime: (html: string) => string;
};

let installed: HtmlAppRuntime | null = null;

/** Install the host's HTML-app runtime. Called once at boot, before render. */
export function setHtmlAppRuntime(runtime: HtmlAppRuntime): void {
  installed = runtime;
}

/** Both entry points install before the first render, so a null here is a
 * boot-order bug — throw rather than make the view carry a dead guard. */
export function htmlAppRuntime(): HtmlAppRuntime {
  if (installed === null) {
    throw new Error("htmlAppRuntime() before setHtmlAppRuntime — boot-order bug");
  }
  return installed;
}
