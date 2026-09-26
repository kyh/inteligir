// The git the packaged app runs on a Mac without the developer tools (src/main/bundled-git.ts),
// staged into resources/git for electron-builder's extraResources. A file fetch pinned by sha-256
// rather than the dugite npm package, whose JS API nothing here calls and whose postinstall would
// download the same tarball on every install.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DUGITE_NATIVE_TAG = "v2.53.0-4";
const GIT_TAG = "v2.53.0";

// script/embedded-git.json in dugite 3.2.3, darwin-arm64
const TARBALL_NAME = "dugite-native-v2.53.0-4098283-macOS-arm64.tar.gz";
const TARBALL = {
  name: TARBALL_NAME,
  sha256: "f9dc64635a5b62fbd7ad95db73268bbb8912255ac516d65d37bf7af22fcb8ffe",
  url: `https://github.com/desktop/dugite-native/releases/download/${DUGITE_NATIVE_TAG}/${TARBALL_NAME}`,
};
// the tarball carries no licence text; git's own, at the commit dugite-native built
const COPYING = {
  name: `git-${GIT_TAG}-COPYING`,
  sha256: "5b2198d1645f767585e8a88ac0499b04472164c0d2da22e75ecf97ef443ab32e",
  url: `https://raw.githubusercontent.com/git/git/${GIT_TAG}/COPYING`,
};

const SOURCE_NOTE = `git ${GIT_TAG.slice(1)}, as built by dugite-native ${DUGITE_NATIVE_TAG}, without the
Git Credential Manager and Git LFS that dugite-native adds beside it.

Licensed under the GNU General Public License, version 2: see COPYING.

Source:
  https://github.com/git/git/tree/${GIT_TAG}
  https://github.com/desktop/dugite-native/tree/${DUGITE_NATIVE_TAG} (the build)
`;

const packageRoot = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(packageRoot, ".cache", "bundled-git");
const payloadDir = path.join(packageRoot, "resources", "git");
const stagingDir = `${payloadDir}.partial`;

// what dugite-native ships beside git: Git Credential Manager (a .NET app, its runtime and its
// locales) and Git LFS. neither the app nor dugite-native's gitconfig names either, and together
// they are two more licences to carry and a hundred-odd MB of binaries to sign
const isThirdParty = (name) => name.startsWith("git-credential-manager") || name === "git-lfs";
const isGitsOwn = (name) =>
  (name === "git" || name.startsWith("git-") || name === "scalar" || name === "mergetools") &&
  !isThirdParty(name);

const log = (line) => {
  process.stdout.write(`fetch-git: ${line}\n`);
};

const sha256Of = async (file) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
};

// cached by name and verified on every run, so a truncated or altered copy is fetched again
const fetchPinned = async ({ name, sha256, url }) => {
  const file = path.join(cacheDir, name);
  if (existsSync(file) && (await sha256Of(file)) === sha256) {
    return file;
  }
  log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const partial = `${file}.partial`;
  await mkdir(cacheDir, { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const actual = await sha256Of(partial);
  if (actual !== sha256) {
    await rm(partial, { force: true });
    throw new Error(`${url} hashed ${actual}, not the pinned ${sha256}`);
  }
  await rename(partial, file);
  return file;
};

const unpack = (tarball, into) => {
  const result = spawnSync("tar", ["-xzf", tarball, "-C", into], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`tar -xzf ${tarball} exited ${result.status ?? result.signal}`);
  }
};

const pruneThirdParty = async (root) => {
  const execDir = path.join(root, "libexec", "git-core");
  const names = await readdir(execDir);
  const pruned = names.filter((name) => !isGitsOwn(name));
  await Promise.all(
    pruned.map(async (name) => {
      await rm(path.join(execDir, name), { force: true, recursive: true });
    }),
  );
  return pruned.length;
};

try {
  const tarball = await fetchPinned(TARBALL);
  const copying = await fetchPinned(COPYING);
  // staged beside the payload and swapped in whole, so an interrupted run never leaves a half tree
  await rm(stagingDir, { force: true, recursive: true });
  await mkdir(stagingDir, { recursive: true });
  unpack(tarball, stagingDir);
  const pruned = await pruneThirdParty(stagingDir);
  await copyFile(copying, path.join(stagingDir, "COPYING"));
  await writeFile(path.join(stagingDir, "SOURCE"), SOURCE_NOTE);
  await rm(payloadDir, { force: true, recursive: true });
  await rename(stagingDir, payloadDir);
  log(`${TARBALL.name} -> ${path.relative(packageRoot, payloadDir)} (${pruned} entries pruned)`);
} catch (error) {
  process.stderr.write(`fetch-git: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
