// Lightweight bridge-binary seeding — kept free of pi-computer-use imports
// so setup.ts can statically pull this in during onboarding without eagerly
// loading the package's runtime. The extension factory is dynamically
// imported when the agent actually starts.
//
// Background: bridge.ts in @injaneity/pi-computer-use spawns its Swift helper
// at a hard-coded path under ~/.pi/agent/helpers/. The package's postinstall
// populates that path in dev; packaged DMG users never run postinstall, so we
// ship the prebuilt binary inside the app and copy the right arch into place.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

import { hashFile } from "@/main/lib/file-utils";

const HELPER_DEST = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "helpers",
  "pi-computer-use",
  "bridge",
);

// Sidecar that records the sha256 of the SOURCE binary we last installed from.
// We can't compare hash(source) === hash(dest) directly because codesign
// mutates dest after copy, so dest never byte-matches source.
const SENTINEL_PATH = `${HELPER_DEST}.src-sha256`;

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

function readSentinel(): string | null {
  try {
    return fs.readFileSync(SENTINEL_PATH, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Copy the prebuilt Swift bridge into the path bridge.ts spawn() expects.
 * Synchronous from start to finish — including ad-hoc codesign — so callers
 * can rely on the binary being launchable the moment this returns. No-op on
 * non-macOS or when the source matches what we last installed (tracked via
 * a sidecar sha256 file because codesign mutates dest after copy).
 */
export function seedComputerUseHelper(): void {
  if (process.platform !== "darwin") return;

  const source = findPrebuiltBridge();
  if (!source) {
    console.warn("[computer-use] no prebuilt bridge found for", process.arch);
    return;
  }

  try {
    const sourceHash = hashFile(source);
    if (fs.existsSync(HELPER_DEST) && readSentinel() === sourceHash) return;

    fs.mkdirSync(path.dirname(HELPER_DEST), { recursive: true });
    fs.copyFileSync(source, HELPER_DEST);
    fs.chmodSync(HELPER_DEST, 0o755);

    // Ad-hoc sign synchronously — without this, a copied unsigned binary may
    // fail to launch under hardened runtime. Must complete before the bridge
    // is ever spawned. A throw here propagates to the outer catch and skips
    // the sentinel write below, so the next run retries from scratch.
    execFileSync("codesign", ["--force", "--sign", "-", HELPER_DEST], {
      stdio: "ignore",
    });

    // Sentinel records the source hash we just successfully installed +
    // signed. Written last so a torn install (failed copy or codesign)
    // leaves no sentinel and the next run retries.
    fs.writeFileSync(SENTINEL_PATH, sourceHash);

    console.log("[computer-use] installed bridge to", HELPER_DEST);
  } catch (err) {
    console.error("[computer-use] failed to seed helper:", err);
  }
}
