// ---------------------------------------------------------------------------
// What serving a vault `.html` app needs from whichever host mounted the
// workspace: the vendored deps and the postMessage broker runtime, woven into
// the app's own HTML. Injected rather than imported — a host that does not
// serve HTML apps installs a refusal here, and the view never needs to know
// which host it runs under.
// ---------------------------------------------------------------------------

export type HtmlAppRuntime = {
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

/** Every entry point installs before the first render, so a null here is a
 * boot-order bug — throw rather than make the view carry a dead guard. */
export function htmlAppRuntime(): HtmlAppRuntime {
  if (installed === null) {
    throw new Error("htmlAppRuntime() before setHtmlAppRuntime — boot-order bug");
  }
  return installed;
}
