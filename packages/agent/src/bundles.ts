// Explicit extension-bundle registry. A static list, deliberately not
// glob-based auto-discovery: `import.meta.glob` is Vite-only and would tie
// this node library to one bundler. Adding an extension = one folder + one
// line here — __tests__/bundles.test.ts fails if a folder is missing from
// the list. Sorted by bundle name for deterministic registration order.

import browser from "./browser/extension";
import codeMode from "./code-mode/extension";
import knowledgeTools from "./knowledge-tools/extension";
import peekaboo from "./peekaboo/extension";
import privacy from "./privacy/extension";
import vaultTools from "./vault-tools/extension";
import type { PiExtensionBundle } from "./extension";

export const EXTENSION_BUNDLES: PiExtensionBundle[] = [
  browser,
  codeMode,
  knowledgeTools,
  peekaboo,
  privacy,
  vaultTools,
].toSorted((a, b) => a.name.localeCompare(b.name));
