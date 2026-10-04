// The Mac app: the shell, the node beside it and the CLI as a resource, signed, notarized when
// <repo>/.release holds the notary key, and the release's assets in .output/bin. The release
// material is read HERE, inside the turbo task, because turbo's strict env mode strips an
// undeclared variable before this process starts; exporting one in the shell reaches nothing.
//
// `bundle.resources` and `externalBin` live in the config this writes, never in tauri.conf.json:
// tauri-build copies both on every cargo build, so a clippy run would copy the 700 MB server, and
// a checkout that never packaged would fail its typecheck for want of them.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeRustNotices } from "./rust-notices.mjs";
import { signResources } from "./sign-resources.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const releaseDir = path.join(repoRoot, ".release");
const outDir = path.join(packageRoot, ".output", "bin");
const bundleDir = path.join(packageRoot, "src-tauri", "target", "release", "bundle");
const { version } = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf-8"));

// every installed app reads its update from the release this tag names
const RELEASES = "https://github.com/kyh/inteligir/releases";
const UPDATER_ENDPOINT = `${RELEASES}/latest/download/latest.json`;
// fixed, so the site links releases/latest/download/Inteligir-arm64.dmg with no lookup
const DMG_NAME = "Inteligir-arm64.dmg";
const UPDATER_ARCHIVE = "Inteligir.app.tar.gz";
// the zip and manifest the Electron builds' updater reads, so an install from before the move to
// Tauri updates onto it: same bundle id and team, so Squirrel accepts the new app
const ELECTRON_ZIP = `Inteligir-${version}-arm64.zip`;
// node 24's own floor (its binary's LC_BUILD_VERSION), which the Electron builds ran below
const MINIMUM_MACOS = "13.5";
// the same floor as the Darwin release electron-updater compares (`os.release()`): macOS 13.5 is
// Darwin 22.6, so an Electron install on an older Mac is offered nothing it cannot open
const MINIMUM_DARWIN = "22.6.0";

const log = (line) => {
  process.stdout.write(`package: ${line}\n`);
};

const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(" ")} exited ${result.status ?? result.signal}`);
  }
};

const readRelease = (name) => {
  const file = path.join(releaseDir, name);
  return existsSync(file) ? readFileSync(file, "utf-8").trim() : null;
};

// electron-builder's names in notary.env, which Tauri reads under its own
const notaryEnv = () => {
  const text = readRelease("notary.env");
  if (text === null) {
    return null;
  }
  const values = {};
  for (const line of text.split("\n")) {
    const match = /^(?<name>APPLE_[A-Z_]+)=(?<value>.+)$/u.exec(line.trim());
    if (match?.groups !== undefined) {
      values[match.groups.name] = match.groups.value;
    }
  }
  return {
    APPLE_API_ISSUER: values.APPLE_API_ISSUER,
    APPLE_API_KEY: values.APPLE_API_KEY_ID,
    APPLE_API_KEY_PATH: path.resolve(releaseDir, values.APPLE_API_KEY ?? ""),
  };
};

// the Developer ID the keychain holds, or `-` for an ad-hoc pack, which opens on the Mac that built it
const signingIdentity = () => {
  if (process.env.INTELIGIR_PACK_UNSIGNED === "1") {
    return "-";
  }
  if (process.env.APPLE_SIGNING_IDENTITY !== undefined) {
    return process.env.APPLE_SIGNING_IDENTITY;
  }
  const listed = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf-8",
  });
  const match = /"(?<identity>Developer ID Application: [^"]+)"/u.exec(listed.stdout ?? "");
  return match?.groups?.identity ?? "-";
};

const sha512Base64 = (file) => createHash("sha512").update(readFileSync(file)).digest("base64");

const findOne = async (dir, suffix) => {
  const entries = await readdir(dir);
  const names = entries.filter((name) => name.endsWith(suffix));
  if (names.length !== 1) {
    throw new Error(`expected one *${suffix} in ${dir}, found ${names.length}`);
  }
  return path.join(dir, names[0]);
};

if (process.platform !== "darwin") {
  throw new Error("the Mac app packs on a Mac: codesign, hdiutil and notarytool are macOS's");
}

const identity = signingIdentity();
const signed = identity !== "-";
const notary = signed ? notaryEnv() : null;
const updaterKey = signed ? readRelease("updater.key") : null;
const updaterPubkey = updaterKey === null ? null : readRelease("updater.key.pub");
if (updaterKey !== null && updaterPubkey === null) {
  throw new Error(".release/updater.key has no updater.key.pub beside it");
}
log(signed ? `signing as ${identity}` : "signing ad-hoc: this pack opens only on this Mac");
log(
  notary === null
    ? `${path.join(releaseDir, "notary.env")} absent or unused — not notarized`
    : `notarizing with ${path.join(releaseDir, "notary.env")}`,
);
log(updaterKey === null ? "no updater key: the app will not update itself" : "signing the update");

run("node", [path.join(packageRoot, "scripts", "stage-server.mjs")]);
const resourceCount = await signResources(
  [path.join(packageRoot, ".output", "server"), path.join(packageRoot, "resources", "git")],
  identity,
  signed,
);
log(`signed ${resourceCount} binaries the resources carry`);
const crateCount = await writeRustNotices(
  path.join(packageRoot, "src-tauri"),
  path.join(packageRoot, ".output", "notices", "rust-crates.txt"),
);
log(`noted the licences of the ${crateCount} Rust crates the shell links`);

const config = {
  bundle: {
    createUpdaterArtifacts: updaterKey !== null,
    externalBin: ["binaries/node"],
    macOS: {
      entitlements: "../resources/entitlements.mac.plist",
      // an ad-hoc pack carries no team, so library validation would refuse its own addons
      hardenedRuntime: signed,
      minimumSystemVersion: MINIMUM_MACOS,
      signingIdentity: identity,
    },
    resources: {
      "../.output/notices/": "notices/",
      "../.output/server/": "server/",
      "../resources/git/": "git/",
      // not `node/`: tauri-build copies the sidecar and the resources into one target folder, where
      // the sidecar is already a file named `node`, and a folder of that name fails the build
      "../resources/node/": "notices/node/",
    },
    targets: ["app", "dmg"],
  },
};
// no key, no feed: the build reports its updates disabled rather than checking one it cannot verify
if (updaterPubkey !== null) {
  config.plugins = { updater: { endpoints: [UPDATER_ENDPOINT], pubkey: updaterPubkey } };
}
const configFile = path.join(packageRoot, ".output", "tauri.package.conf.json");
await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);

const env = { ...process.env, ...notary };
if (updaterKey !== null) {
  env.TAURI_SIGNING_PRIVATE_KEY = updaterKey;
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = readRelease("updater.key.password") ?? "";
}
await rm(bundleDir, { force: true, recursive: true });
run("pnpm", ["exec", "tauri", "build", "--config", configFile], { cwd: packageRoot, env });

await rm(outDir, { force: true, recursive: true });
await mkdir(outDir, { recursive: true });
await copyFile(await findOne(path.join(bundleDir, "dmg"), ".dmg"), path.join(outDir, DMG_NAME));
const app = path.join(bundleDir, "macos", "Inteligir.app");

if (updaterKey !== null) {
  const archive = path.join(bundleDir, "macos", UPDATER_ARCHIVE);
  await copyFile(archive, path.join(outDir, UPDATER_ARCHIVE));
  await copyFile(`${archive}.sig`, path.join(outDir, `${UPDATER_ARCHIVE}.sig`));
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
  await writeFile(path.join(outDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);

  const zip = path.join(outDir, ELECTRON_ZIP);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const manifest = [
    `version: ${version}`,
    "files:",
    `  - url: ${ELECTRON_ZIP}`,
    `    sha512: ${sha512Base64(zip)}`,
    `    size: ${String(statSync(zip).size)}`,
    `path: ${ELECTRON_ZIP}`,
    `sha512: ${sha512Base64(zip)}`,
    `minimumSystemVersion: ${MINIMUM_DARWIN}`,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "latest-mac.yml"), manifest);
}

log(
  `${path.relative(packageRoot, app)} and the release assets in ${path.relative(packageRoot, outDir)}`,
);
