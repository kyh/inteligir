// Explicit extension-bundle registry. The old auto-discovery used Vite's
// import.meta.glob, which ties the host library to one bundler; a static
// list is honest and portable. Adding an extension = one folder + one line
// here — __tests__/bundles.test.ts fails if a folder is missing from the
// list. Sorted by bundle name for deterministic registration order.

import browser from "./browser/extension";
import executor from "./executor/extension";
import knowledge from "./knowledge/extension";
import peekaboo from "./peekaboo/extension";
import privacy from "./privacy/extension";
import type { PiExtensionBundle } from "./extension";

export const EXTENSION_BUNDLES: PiExtensionBundle[] = [
  browser,
  executor,
  knowledge,
  peekaboo,
  privacy,
].toSorted((a, b) => a.name.localeCompare(b.name));
