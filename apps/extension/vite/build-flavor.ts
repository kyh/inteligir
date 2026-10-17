// a build's flavor is its vite mode: `--mode store` is the store's (scripts/package.ts writes the
// unpacked store build from it), and every other mode, `--mode dev` included, is the dev build,
// which dials the dev host; the store package refuses a manifest that carries a key or a host.

import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ExtensionFlavor } from "../src/manifest";

export const flavorOfMode = (mode: string): ExtensionFlavor => (mode === "store" ? "store" : "dev");

const manifestSchema = z.looseObject({ version: z.string().min(1) });

// the extension's version is its package's
export const extensionVersion = (): string =>
  manifestSchema.parse(
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")),
  ).version;
