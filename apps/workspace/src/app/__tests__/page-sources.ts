import { readdirSync } from "node:fs";
import path from "node:path";

export const pageSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : pageSources(full);
    }
    return /\.tsx?$/u.test(entry.name) ? [full] : [];
  });
