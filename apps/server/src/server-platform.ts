// ---------------------------------------------------------------------------
// The headless-node implementation of HostPlatform — the cli counterpart of
// the desktop shell's electron-platform.ts. No native dialogs (the vault is
// fixed at boot, so pickDirectory is absent and the UI hides the affordance)
// and no OS keychain (secrets ride the file-key AES-GCM cipher).
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import open from "open";

import { createFileKeyCipher } from "@repo/host/lib/file-key-cipher";
import { inteligirPath } from "@repo/host/lib/json-store";
import type { HostPlatform } from "@repo/host/platform";

/**
 * Per-user data dir for large assets that must survive logout (voice
 * models). NOT ~/.inteligir — logout rm -rf's that dir. Mirrors Electron's
 * per-platform userData location so a desktop install and the cli share one
 * model download.
 */
function userDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "Inteligir");
    case "win32":
      return path.join(
        process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming"),
        "Inteligir",
      );
    default:
      return path.join(
        process.env["XDG_DATA_HOME"] ?? path.join(home, ".local", "share"),
        "inteligir",
      );
  }
}

export function createServerPlatform(): HostPlatform {
  // Bundled agent resources (skills/, AGENTS.md) ship inside @repo/host;
  // resolve them through the package instead of guessing repo layout.
  const hostPackageJson = createRequire(import.meta.url).resolve("@repo/host/package.json");
  const resourcesDir = path.join(path.dirname(hostPackageJson), "resources", "agent");

  return {
    userDataDir: userDataDir(),
    resourcesDir,
    // A source checkout / npm install missing optional resources is a
    // warn-and-continue, not a corrupt packaged app.
    strictResources: false,
    secretCipher: createFileKeyCipher(inteligirPath("secret.key")),
    openExternal: async (url) => {
      await open(url);
    },
    notify: (notification) => {
      console.log(`[notify] ${notification.title} — ${notification.body}`);
    },
    // No window focus signal in a headless server: always deliver.
    anyUiFocused: () => false,
  };
}
