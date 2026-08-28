// Where this shell's own build output lives, spelled ONCE.
//
// Every path here is resolved from `app.getAppPath()` rather than the running
// module's `__dirname`: the main bundle is one file whose location is a fact
// about the bundler, while the app path is Electron's own answer and is the
// same shape in a checkout and inside `app.asar`.
//
// The two preloads are `.cjs` because both windows run `sandbox: true`, and a
// sandboxed preload has no ES module loader — an `.js` preload in a
// `"type": "module"` package is parsed as ESM and silently never runs, leaving
// the page with no bridge and no error.

import { join } from "node:path";
import { app } from "electron";

/** The directory electron-vite writes into, relative to the app path. */
const OUTPUT_DIR = [".output", "app"];

function bundlePath(...segments: string[]): string {
  return join(app.getAppPath(), ...OUTPUT_DIR, ...segments);
}

/** The built SPA the app protocol serves. */
export function rendererDir(): string {
  return bundlePath("renderer");
}

/** The app window's bridge: the socket origin the renderer cannot derive from
 *  a custom scheme. */
export function appPreloadScript(): string {
  return bundlePath("preload", "index.cjs");
}

/** The in-app browser's chrome bar — the browser window's own preload, and its
 *  fixed verb set. */
export function browserChromePreloadScript(): string {
  return bundlePath("preload", "browser-preload.cjs");
}

export function browserChromePage(): string {
  return bundlePath("preload", "browser-chrome.html");
}
