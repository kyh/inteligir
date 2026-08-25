// Where this program's own files are, in BOTH layouts it runs in: `src/*.ts`
// under tsx in a checkout, and the `dist/index.js` bundle in a packaged
// install. Every module under `src/` is inlined into that bundle, so
// `import.meta.url` names the bundle there and this file's own path here —
// which is why the resolver lives ONE level under the package root, where the
// same `../` reaches it either way. A module a level deeper cannot do this.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const packageRootUrl = new URL("../", import.meta.url);

const manifestSchema = z.looseObject({ version: z.string() });

/** A file or directory this package ships, by its path from the package root. */
export function packageFile(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, packageRootUrl));
}

export function readCliVersion(): string {
  try {
    const manifest = manifestSchema.safeParse(
      JSON.parse(readFileSync(new URL("package.json", packageRootUrl), "utf8")),
    );
    if (manifest.success) {
      return manifest.data.version;
    }
  } catch {
    // Fall through to the placeholder.
  }
  return "0.0.0";
}

/**
 * The built workspace UI, or null when this checkout has not built one.
 *
 * `serve` answers the SPA over plain HTTP so `inteligir serve --open` lands a
 * browser in the product — the zero-install path, kept as a verb. The bundle is
 * the DESKTOP renderer's, staged here at build time rather than resolved across
 * packages at runtime: one directory, one place that knows its name.
 */
export function resolveUiDir(): string | null {
  const staged = packageFile("dist/ui");
  return existsSync(staged) ? staged : null;
}

/**
 * The committed SQL migrations, or undefined to let `@repo/db` resolve its own
 * source-adjacent default. The bundle carries a copy beside itself because the
 * package it would otherwise resolve through does not ship.
 */
export function resolveMigrationsFolder(): string | undefined {
  const bundled = packageFile("dist/drizzle");
  return existsSync(bundled) ? bundled : undefined;
}
