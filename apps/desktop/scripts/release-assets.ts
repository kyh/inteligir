// A pack's release assets, in .output/bin under the names a release carries: the dmg, the signed
// update, and the feed every installed app reads. Tauri names its bundles by version and writes no
// feed.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import manifest from "../../../package.json" with { type: "json" };

const packageRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(packageRoot, ".output", "bin");
const bundleDir = path.join(packageRoot, "src-tauri", "target", "release", "bundle");
const { version } = manifest;

const RELEASES = "https://github.com/kyh/inteligir/releases";
// fixed, so the site links releases/latest/download/Inteligir-arm64.dmg with no lookup
const DMG_NAME = "Inteligir-arm64.dmg";
const UPDATER_ARCHIVE = "Inteligir.app.tar.gz";

// Tauri signs with no identity and notarizes with no key by skipping the step and logging it, so
// the ticket is asked for here: an app without one is no release
execFileSync("xcrun", ["stapler", "validate", path.join(bundleDir, "macos", "Inteligir.app")], {
  stdio: "inherit",
});

mkdirSync(outDir, { recursive: true });
copyFileSync(
  path.join(bundleDir, "dmg", `Inteligir_${version}_aarch64.dmg`),
  path.join(outDir, DMG_NAME),
);
const archive = path.join(bundleDir, "macos", UPDATER_ARCHIVE);
copyFileSync(archive, path.join(outDir, UPDATER_ARCHIVE));
copyFileSync(`${archive}.sig`, path.join(outDir, `${UPDATER_ARCHIVE}.sig`));
const latest = {
  notes: `${RELEASES}/tag/v${version}`,
  platforms: {
    "darwin-aarch64": {
      signature: readFileSync(`${archive}.sig`, "utf-8"),
      url: `${RELEASES}/download/v${version}/${UPDATER_ARCHIVE}`,
    },
  },
  pub_date: new Date().toISOString(),
  version,
};
writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
