// resolved from `app.getAppPath()`, not `__dirname`: the same shape in a checkout and in app.asar.
// preloads are `.cjs`: a sandboxed preload has no ES module loader, and an ESM one silently never runs.

import path from "node:path";
import { app } from "electron";

const OUTPUT_DIR = [".output", "app"];

const bundlePath = (...segments: string[]): string =>
  path.join(app.getAppPath(), ...OUTPUT_DIR, ...segments);

export const rendererDir = (): string => bundlePath("renderer");

export const appPreloadScript = (): string => bundlePath("preload", "index.cjs");
