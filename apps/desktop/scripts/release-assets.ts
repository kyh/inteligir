import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import manifest from "../../../package.json" with { type: "json" };

const packageRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(packageRoot, ".output", "bin");
const bundleDir = path.join(packageRoot, "src-tauri", "target", "release", "bundle");
const { version } = manifest;

const RELEASES = "https://github.com/kyh/inteligir/releases";
const DMG_NAME = "Inteligir-arm64.dmg";
const UPDATER_ARCHIVE = "Inteligir.app.tar.gz";

execFileSync("xcrun", ["stapler", "validate", path.join(bundleDir, "macos", "Inteligir.app")], {
  stdio: "inherit",
});

const releaseValue = (name: string) => {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(
      `${name} is unset: package through pnpm package:desktop, which reads .release/release.env`,
    );
  }

  return value;
};

mkdirSync(outDir, { recursive: true });

const dmg = path.join(outDir, DMG_NAME);

copyFileSync(path.join(bundleDir, "dmg", `Inteligir_${version}_aarch64.dmg`), dmg);

execFileSync(
  "xcrun",
  [
    "notarytool",
    "submit",
    dmg,
    "--wait",
    "--key",
    releaseValue("APPLE_API_KEY_PATH"),
    "--key-id",
    releaseValue("APPLE_API_KEY"),
    "--issuer",
    releaseValue("APPLE_API_ISSUER"),
  ],
  { stdio: "inherit" },
);

execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });

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
