// ---------------------------------------------------------------------------
// Computer-use helper seeding — lightweight module, no pi-computer-use import.
//
// Kept separate from computer-use-tool.ts so setup.ts can statically import
// the seed function during onboarding without eagerly pulling in the
// @injaneity/pi-computer-use package and its Swift bridge runtime. The
// extension factory itself is dynamically imported when the agent starts.
//
// The pi-computer-use bridge spawns its Swift helper at a hard-coded path:
//   ~/.pi/agent/helpers/pi-computer-use/bridge
// In dev the package's postinstall populates that path. Packaged builds skip
// the postinstall, so we ship the prebuilt binary inside the app and copy
// the right arch into place during onboarding.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

const HELPER_DEST = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "helpers",
  "pi-computer-use",
  "bridge",
);

declare const __PROJECT_ROOT__: string;

function findPrebuiltBridge(): string | null {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!arch) return null;

  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "computer-use", arch, "bridge");
    return fs.existsSync(bundled) ? bundled : null;
  }

  const prebuilt = path.join(
    __PROJECT_ROOT__,
    "node_modules",
    "@injaneity",
    "pi-computer-use",
    "prebuilt",
    "macos",
    arch,
    "bridge",
  );
  return fs.existsSync(prebuilt) ? prebuilt : null;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Copy the prebuilt Swift bridge into the path bridge.ts spawn() expects.
 * Synchronous from start to finish — including ad-hoc codesign — so callers
 * can rely on the binary being launchable the moment this returns. No-op on
 * non-macOS or when the destination already matches the source by sha256.
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

    // Ad-hoc sign synchronously — without this, a copied unsigned binary may
    // fail to launch under hardened runtime. Must complete before the bridge
    // is ever spawned.
    try {
      execFileSync("codesign", ["--force", "--sign", "-", HELPER_DEST], {
        stdio: "ignore",
      });
    } catch (err) {
      console.warn(
        "[computer-use] codesign failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    console.log("[computer-use] installed bridge to", HELPER_DEST);
  } catch (err) {
    console.error("[computer-use] failed to seed helper:", err);
  }
}
