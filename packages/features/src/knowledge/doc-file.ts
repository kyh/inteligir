// Single source of truth for "what is an editable markdown doc" — shared by
// VaultManager's entry classification, the knowledge index, and the dev
// harness's fixture bridge, so they can never drift.

import { extnamePath } from "./vault-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

/** True when the path names an editable markdown/text doc (by extension). */
export function isDocPath(path: string): boolean {
  return DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());
}
