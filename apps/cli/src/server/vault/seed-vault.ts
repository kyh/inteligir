// The virgin-boot vault content: a starter set of notes (Welcome, the two
// onboarding docs, a kitchen sink) with their comment sidecars and
// referenced assets, shipped as FILES beside this program rather than imported
// (the skills-dir pattern — content the product reads, not code it imports).
// Every seed .md is byte-canonical through the fixpoint serializer, pinned by
// __tests__/seed-vault.test.ts.

import { cp } from "node:fs/promises";
import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The one seed the app can always produce: a resolver miss on a broken
 *  staging must degrade to the old single-file welcome, never to an empty
 *  vault whose first open is a blank pane. */
const FALLBACK_WELCOME = `# Welcome to inteligir

This folder is your vault: plain markdown files that belong to you, versioned with git. Edit them here or with any other tool — changes show up either way.
`;

/**
 * The seed directory, resolved from whichever layout this module runs in:
 * `src/server/vault/` under tsx, or the `dist/` bundle, which is inlined so
 * `import.meta.url` names the bundle itself. Both land on the package's own
 * `seed/`. Null when neither exists — a staging bug, absorbed by the fallback
 * rather than surfaced as a broken first run.
 */
export function resolveSeedDir(moduleUrl: string = import.meta.url): string | null {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    // source: src/server/vault → <package>/seed
    join(here, "..", "..", "..", "seed"),
    // bundle: dist → <package>/seed
    join(here, "..", "seed"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Try the next layout.
    }
  }
  return null;
}

/**
 * Populate a just-created vault. Runs only inside ensureVaultRepo's `created`
 * branch, BEFORE the born-HEAD commit — that first commit is the stated
 * unscoped `add -A`, so nothing here needs to name paths for the scheduler.
 */
export async function seedVault(vaultRoot: string): Promise<void> {
  const seedDir = resolveSeedDir();
  if (seedDir === null) {
    await writeFile(join(vaultRoot, "Welcome.md"), FALLBACK_WELCOME, "utf8");
    return;
  }
  await cp(seedDir, vaultRoot, { recursive: true });
}
