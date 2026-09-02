// The one tree walk the renderer's own guards share: every source file under
// a directory, tests excluded — a walk rather than a list, so a surface
// written tomorrow is covered the day it appears.

import { readdirSync } from "node:fs";
import { join } from "node:path";

export function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : rendererSources(full);
    return /\.tsx?$/u.test(entry.name) ? [full] : [];
  });
}
