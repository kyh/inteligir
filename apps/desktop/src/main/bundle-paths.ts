// resolved from `app.getAppPath()`, not `__dirname`: the same shape in a checkout and in app.asar.
// preloads are `.cjs`: a sandboxed preload has no ES module loader, and an ESM one silently never runs.

import { join } from "node:path";
import { app } from "electron";

const OUTPUT_DIR = [".output", "app"];

function bundlePath(...segments: string[]): string {
  return join(app.getAppPath(), ...OUTPUT_DIR, ...segments);
}

export function rendererDir(): string {
  return bundlePath("renderer");
}

export function appPreloadScript(): string {
  return bundlePath("preload", "index.cjs");
}

export function browserChromePreloadScript(): string {
  return bundlePath("preload", "browser-preload.cjs");
}

export function browserChromePage(): string {
  return bundlePath("preload", "browser-chrome.html");
}
