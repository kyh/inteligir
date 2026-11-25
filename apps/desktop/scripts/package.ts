import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build, Platform } from "electron-builder";
import manifest from "../../../package.json" with { type: "json" };

const packageRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(packageRoot, ".output", "bin");
const { version } = manifest;

const DMG_NAME = "Inteligir-arm64.dmg";
const ZIP_NAME = "Inteligir-arm64.zip";

const releaseValue = (name: string) => {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(
      `${name} is unset: package through pnpm package:desktop, which reads .release/release.env`,
    );
  }

  return value;
};

for (const name of ["CSC_NAME", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
  releaseValue(name);
}

await build({
  config: {
    appId: "com.inteligir.desktop",
    // oxlint-disable-next-line no-template-curly-in-string -- electron-builder expands its own ${arch} and ${ext}
    artifactName: "Inteligir-${arch}.${ext}",
    directories: { buildResources: "resources", output: ".output/bin" },
    extraMetadata: { version },
    extraResources: [{ from: "resources/Assets.car", to: "Assets.car" }],
    files: [".output/app/**", "package.json"],
    forceCodeSigning: true,
    mac: {
      category: "public.app-category.productivity",
      extendInfo: { CFBundleIconName: "app" },
      hardenedRuntime: true,
      icon: "resources/icon.icns",
      minimumSystemVersion: "13.5",
      notarize: true,
      target: [
        { arch: ["arm64"], target: "dmg" },
        { arch: ["arm64"], target: "zip" },
      ],
    },
    productName: "Inteligir",
    publish: { owner: "kyh", provider: "github", repo: "inteligir" },
  },
  projectDir: packageRoot,
  publish: "never",
  targets: Platform.MAC.createTarget(),
});

const app = path.join(outDir, "mac-arm64", "Inteligir.app");
const dmg = path.join(outDir, DMG_NAME);

execFileSync("xcrun", ["stapler", "validate", app], { stdio: "inherit" });

execFileSync(
  "xcrun",
  [
    "notarytool",
    "submit",
    dmg,
    "--wait",
    "--key",
    releaseValue("APPLE_API_KEY"),
    "--key-id",
    releaseValue("APPLE_API_KEY_ID"),
    "--issuer",
    releaseValue("APPLE_API_ISSUER"),
  ],
  { stdio: "inherit" },
);

execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });

const feed = path.join(outDir, "latest-mac.yml");
const sha512 = createHash("sha512").update(readFileSync(dmg)).digest("base64");
const { size } = statSync(dmg);

writeFileSync(
  feed,
  readFileSync(feed, "utf-8").replace(
    new RegExp(
      `(- url: ${DMG_NAME.replaceAll(".", "\\.")}\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`,
      "u",
    ),
    `$1${sha512}$2${size}`,
  ),
);

for (const asset of [DMG_NAME, ZIP_NAME, `${ZIP_NAME}.blockmap`, "latest-mac.yml"]) {
  statSync(path.join(outDir, asset));
}
