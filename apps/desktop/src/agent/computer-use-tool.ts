// ---------------------------------------------------------------------------
// Computer-use tool — native macOS GUI control via @injaneity/pi-computer-use
//
// The package's TypeScript bridge spawns a Swift helper at a hard-coded path:
//   ~/.pi/agent/helpers/pi-computer-use/bridge
//
// In dev the package's postinstall populates that path. In packaged builds
// there's no postinstall, so we ship the prebuilt binary inside the app and
// copy the right arch into place during onboarding (see seedComputerUseHelper).
//
// Browser windows are intentionally out of scope here — our CDP-based browser
// tool covers the web. We force pi-computer-use's `browser_use` flag off via
// PI_COMPUTER_USE_BROWSER_USE=0 so the bridge refuses browser targets.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

import computerUseExtension from "@injaneity/pi-computer-use/extensions/computer-use.ts";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Path the pi-computer-use bridge spawns at runtime — hardcoded in the package. */
const HELPER_DEST = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "helpers",
  "pi-computer-use",
  "bridge",
);

declare const __PROJECT_ROOT__: string;

/**
 * Locate the prebuilt Swift bridge for the current arch.
 * - Packaged: bundled under resources/computer-use/{arch}/bridge (extraResources).
 * - Dev: read directly from the installed package's prebuilt/ dir.
 */
function findPrebuiltBridge(): string | null {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!arch) return null;

  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "computer-use", arch, "bridge");
    return fs.existsSync(bundled) ? bundled : null;
  }

  // Dev: resolve via the installed package
  const pkgRoot = path.join(
    __PROJECT_ROOT__,
    "node_modules",
    "@injaneity",
    "pi-computer-use",
  );
  const prebuilt = path.join(pkgRoot, "prebuilt", "macos", arch, "bridge");
  return fs.existsSync(prebuilt) ? prebuilt : null;
}

/**
 * Copy the prebuilt Swift bridge into the path the bridge.ts spawn() expects.
 * No-op on non-macOS, or if the destination already matches the source.
 */
export function seedComputerUseHelper(): void {
  if (process.platform !== "darwin") return;

  const source = findPrebuiltBridge();
  if (!source) {
    console.warn("[computer-use] no prebuilt bridge found for", process.arch);
    return;
  }

  try {
    if (fs.existsSync(HELPER_DEST)) {
      const [src, dst] = [fs.statSync(source).size, fs.statSync(HELPER_DEST).size];
      if (src === dst) return;
    }
    fs.mkdirSync(path.dirname(HELPER_DEST), { recursive: true });
    fs.copyFileSync(source, HELPER_DEST);
    fs.chmodSync(HELPER_DEST, 0o755);

    // Ad-hoc sign so macOS treats this as a fresh local binary; without this,
    // a copied unsigned binary may fail to launch under hardened runtime.
    execFile("codesign", ["--force", "--sign", "-", HELPER_DEST], (err) => {
      if (err) console.warn("[computer-use] codesign failed:", err.message);
    });

    console.log("[computer-use] installed bridge to", HELPER_DEST);
  } catch (err) {
    console.error("[computer-use] failed to seed helper:", err);
  }
}

/**
 * Force browser_use off so the bridge declines browser windows. Our CDP-based
 * browser tool handles the web; pi-computer-use is for native apps only.
 * Must run before any extension factory imports the config module.
 */
export function applyComputerUseEnv(): void {
  process.env["PI_COMPUTER_USE_BROWSER_USE"] = "0";
}

/** Pi extension factory — registers list_apps, screenshot, click, etc. */
export function registerComputerUseExtension(pi: ExtensionAPI): void {
  computerUseExtension(pi);
}
