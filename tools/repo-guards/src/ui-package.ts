import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "./repo";

export const UI_DIR = "packages/ui";
export const UI_PACKAGE = "@repo/ui";

// a gallery proves a component renders, not that the product needs it, so the orphan guard does not
// count it as a consumer.
export const GALLERY_DIR = "apps/web/src/components/gallery";

export interface UiRoot {
  dir: string;
  subpath: string;
}

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
