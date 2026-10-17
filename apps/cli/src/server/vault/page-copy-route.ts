// a kept copy of a saved page, on a route of its own: its policy is a script-less sandbox the asset
// route's is not, and the viewer frames it by its url, never as a srcdoc.

import type { Context } from "hono";
import type { VaultService } from "./vault-service";

// PIVOT-STUB(S2): serves the copy (.html under PAGES_DIR only) with its sandboxed policy (§12.3 point 3)
export const handlePageCopy = (c: Context, _vault: VaultService): Response =>
  c.text("Not found", 404);
