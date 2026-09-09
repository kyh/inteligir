import { cp, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// a resolver miss on a broken staging degrades to this, never to an empty vault.
const FALLBACK_WELCOME = `# Welcome to inteligir

This folder is your vault: plain markdown files that belong to you, versioned with git. Edit them here or with any other tool — changes show up either way.
`;

export const resolveSeedDir = (moduleUrl: string = import.meta.url): string | null => {
  const here = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    // source: src/server/vault → <package>/seed
    path.join(here, "..", "..", "..", "seed"),
    // bundle: dist → <package>/seed
    path.join(here, "..", "seed"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Try the next layout.
    }
  }
  return null;
};

// runs before the born-head commit, whose unscoped add -A stages this; nothing here names paths.
export const seedVault = async (vaultRoot: string): Promise<void> => {
  const seedDir = resolveSeedDir();
  if (seedDir === null) {
    await writeFile(path.join(vaultRoot, "Welcome.md"), FALLBACK_WELCOME, "utf-8");
    return;
  }
  await cp(seedDir, vaultRoot, { recursive: true });
};
