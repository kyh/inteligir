// every src module is inlined into dist/index.js, so `import.meta.url` names the bundle there and this file here;
// the same `../` reaches the package root from both only because this file sits one level under it.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const packageRootUrl = new URL("../", import.meta.url);

const manifestSchema = z.looseObject({ version: z.string() });

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
    // fall through to the placeholder.
  }
  return "0.0.0";
}

export function resolveUiDir(): string | null {
  const staged = packageFile("dist/ui");
  return existsSync(staged) ? staged : null;
}

// workspace first: `dist/` is the normal state of a worked-in checkout, and a staged-first answer would boot
// against a frozen snapshot, withholding the newest migration or migrating the dev db past what the code understands.
// resolved through @repo/db/migrate because the package exports no ./drizzle subpath.
export function resolveMigrationsFolder(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const source = join(dirname(require.resolve("@repo/db/migrate")), "..", "drizzle");
    if (statSync(source).isDirectory()) return source;
  } catch {
    // a published install resolves no workspace package and reads the staged copy instead.
  }
  const bundled = packageFile("dist/drizzle");
  return existsSync(bundled) ? bundled : undefined;
}
