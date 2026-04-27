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
// tool covers the web. computer-use-env.ts (imported below) sets
// PI_COMPUTER_USE_BROWSER_USE=0 so the bridge refuses browser targets; that
// import must precede the pi-computer-use import to take effect.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

// MUST stay first — sets PI_COMPUTER_USE_BROWSER_USE=0 before the package loads.
// ESM evaluates imports depth-first in source order, so any side-effect import
// listed before the pi-computer-use import is guaranteed to run first.
import "@/agent/computer-use-env";
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
    if (fs.existsSync(HELPER_DEST) && sha256(source) === sha256(HELPER_DEST)) {
      return;
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

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Pi extension factory — registers list_apps, screenshot, click, etc. */
export function registerComputerUseExtension(pi: ExtensionAPI): void {
  computerUseExtension(pi);
}
