// The Mac app: the shell, the node beside it and the CLI as a resource, signed, notarized when
// <repo>/.release holds the notary key, and the release's assets in .output/bin. The release
// material is read HERE, inside the turbo task, because turbo's strict env mode strips an
// undeclared variable before this process starts; exporting one in the shell reaches nothing.
//
// `bundle.resources` and `externalBin` live in the config this writes, never in tauri.conf.json:
// tauri-build copies both on every cargo build, so a clippy run would copy the 700 MB server, and
// a checkout that never packaged would fail its typecheck for want of them.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import manifest from "../package.json" with { type: "json" };
import { fetchGit } from "./fetch-git.ts";
import { fetchNode } from "./fetch-node.ts";
import { run } from "./run.ts";
import { writeRustNotices } from "./rust-notices.ts";
import { signResources } from "./sign-resources.ts";
import { stageServer } from "./stage-server.ts";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const releaseDir = path.join(repoRoot, ".release");
const outDir = path.join(packageRoot, ".output", "bin");
const bundleDir = path.join(packageRoot, "src-tauri", "target", "release", "bundle");
const { version } = manifest;

// every installed app reads its update from the release this tag names
const RELEASES = "https://github.com/kyh/inteligir/releases";
const UPDATER_ENDPOINT = `${RELEASES}/latest/download/latest.json`;
// fixed, so the site links releases/latest/download/Inteligir-arm64.dmg with no lookup
const DMG_NAME = "Inteligir-arm64.dmg";
const UPDATER_ARCHIVE = "Inteligir.app.tar.gz";
// node 24's own floor (its binary's LC_BUILD_VERSION)
const MINIMUM_MACOS = "13.5";

const log = (line: string): void => {
  process.stdout.write(`package: ${line}\n`);
};

const readRelease = (name: string): string | null => {
  const file = path.join(releaseDir, name);
  return existsSync(file) ? readFileSync(file, "utf-8").trim() : null;
};

// notary.env's App Store Connect key, under the names Tauri reads: the issuer, the key's id and the
// .p8's path, relative to .release
const NOTARY_VARIABLES = ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"] as const;
// Tauri notarizes with an Apple ID too; only .release names a notary, so neither set exported in
// the shell reaches a pack
const INHERITED_NOTARY_VARIABLES = new Set<string>([
  ...NOTARY_VARIABLES,
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
]);

type NotaryEnv = Record<(typeof NOTARY_VARIABLES)[number], string>;

const notaryEnv = (): NotaryEnv | null => {
  const text = readRelease("notary.env");
  if (text === null) {
    return null;
  }
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const { name, value } =
      /^(?<name>APPLE_[A-Z_]+)=(?<value>.+)$/u.exec(line.trim())?.groups ?? {};
    if (name !== undefined && value !== undefined) {
      values.set(name, value);
    }
  }
  const issuer = values.get("APPLE_API_ISSUER");
  const key = values.get("APPLE_API_KEY");
  const keyPath = values.get("APPLE_API_KEY_PATH");
  if (issuer === undefined || key === undefined || keyPath === undefined) {
    const missing = NOTARY_VARIABLES.filter((name) => !values.has(name));
    throw new Error(`.release/notary.env has no ${missing.join(", ")} (docs/releasing.md)`);
  }
  return {
    APPLE_API_ISSUER: issuer,
    APPLE_API_KEY: key,
    APPLE_API_KEY_PATH: path.resolve(releaseDir, keyPath),
  };
};

// the Developer ID the keychain holds, or `-` for an ad-hoc pack, which opens on the Mac that built it
const signingIdentity = (): string => {
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

const findOne = async (dir: string, suffix: string): Promise<string> => {
  const entries = await readdir(dir);
  const names = entries.filter((entry) => entry.endsWith(suffix));
  const [name] = names;
  if (name === undefined || names.length > 1) {
    throw new Error(`expected one *${suffix} in ${dir}, found ${names.length}`);
  }
  return path.join(dir, name);
};

if (process.platform !== "darwin") {
  throw new Error("the Mac app packs on a Mac: codesign, hdiutil and notarytool are macOS's");
}

await fetchGit();
await fetchNode();

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

await stageServer();
const resourceCount = await signResources(
  {
    jit: path.join(packageRoot, ".output", "server"),
    plain: path.join(packageRoot, "resources", "git"),
  },
  identity,
);
log(`signed ${resourceCount} binaries the resources carry`);
const crateCount = await writeRustNotices(
  path.join(packageRoot, "src-tauri"),
  path.join(packageRoot, ".output", "notices", "rust-crates.txt"),
);
log(`noted the licences of the ${crateCount} Rust crates the shell links`);

// the fields of Tauri's config this pack sets over tauri.conf.json
interface PackageConfig {
  bundle: {
    createUpdaterArtifacts: boolean;
    externalBin: string[];
    macOS: {
      entitlements: string;
      hardenedRuntime: boolean;
      minimumSystemVersion: string;
      signingIdentity: string;
    };
    resources: Record<string, string>;
    targets: string[];
  };
  plugins?: { updater: { endpoints: string[]; pubkey: string } };
}

const config: PackageConfig = {
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

const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !INHERITED_NOTARY_VARIABLES.has(name)),
  ),
  ...notary,
};
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
}

log(
  `${path.relative(packageRoot, app)} and the release assets in ${path.relative(packageRoot, outDir)}`,
);
