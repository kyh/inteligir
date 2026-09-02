// What every guard over @repo/ui shares: where the package lives, the
// directories its exports map publishes wholesale, and the one importer that
// does not count as a consumer.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "./repo";

export const UI_DIR = "packages/ui";
export const UI_PACKAGE = "@repo/ui";

/** The component gallery imports EVERY component by design. A gallery proves
 *  a component RENDERS, not that the product NEEDS it — so the orphan guard
 *  does not count it as a consumer, and the coverage guard reads it alone. */
export const GALLERY_DIR = "apps/desktop/src/renderer/app/gallery";

export interface UiRoot {
  /** Directory under `packages/ui/src`. */
  dir: string;
  /** The `@repo/ui/<subpath>/<name>` segment consumers import it by. */
  subpath: string;
}

/** The swept roots, derived from the package's own exports map: every
 *  `./<dir>/*` wildcard row publishes `src/<dir>`, which is exactly the set of
 *  directories whose files are public entries. */
export function sweptRoots(): UiRoot[] {
  const manifestPath = path.join(REPO_ROOT, UI_DIR, "package.json");
  const parsed = z
    .looseObject({ exports: z.record(z.string(), z.string()) })
    .safeParse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  if (!parsed.success) {
    throw new Error(`${manifestPath}: expected an "exports" map of subpath → file`);
  }
  const roots: UiRoot[] = [];
  for (const [key, target] of Object.entries(parsed.data.exports)) {
    const wildcard = /^\.\/([\w-]+)\/\*$/.exec(key);
    if (wildcard?.[1] !== undefined && target.startsWith("./src/")) {
      roots.push({ dir: wildcard[1], subpath: wildcard[1] });
    }
  }
  if (roots.length === 0) {
    throw new Error(
      `${manifestPath}: no "./<dir>/*" wildcard exports found — the guards have nothing to sweep`,
    );
  }
  return roots;
}
