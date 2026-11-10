import { z } from "zod";
import { readJsonFile } from "./repo";

export const UI_DIR = "packages/ui";
export const UI_PACKAGE = "@repo/ui";

// a gallery proves a component renders, not that the product needs it, so the orphan guard does not
// count it as a consumer.
export const GALLERY_DIR = "tools/ui-gallery";

export interface UiRoot {
  dir: string;
  subpath: string;
}

export const sweptRoots = (): UiRoot[] => {
  const manifestPath = `${UI_DIR}/package.json`;
  const { exports } = readJsonFile(
    manifestPath,
    z.looseObject({ exports: z.record(z.string(), z.string()) }),
    'an "exports" map of subpath → file',
  );
  const roots: UiRoot[] = [];
  for (const [key, target] of Object.entries(exports)) {
    const dir = /^\.\/(?<dir>[\w-]+)\/\*$/u.exec(key)?.groups?.dir;
    if (dir !== undefined && target.startsWith("./src/")) {
      roots.push({ dir, subpath: dir });
    }
  }
  if (roots.length === 0) {
    throw new Error(
      `${manifestPath}: no "./<dir>/*" wildcard exports found — the guards have nothing to sweep`,
    );
  }
  return roots;
};
