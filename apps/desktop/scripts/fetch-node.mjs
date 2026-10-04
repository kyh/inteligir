// The node the packaged app runs its server on, and every node child the server starts: the shell
// is Rust, and a Mac need hold no node of its own. The official build, pinned by sha-256, staged
// where `bundle.externalBin` finds it (src-tauri/binaries/node-<target>, which Tauri places beside
// the shell as Contents/MacOS/node), with its licence in resources/node for Contents/Resources.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// held to the major `engines.node` names; a bump re-pins the hash from the release's SHASUMS256.txt
const VERSION = "v24.21.0";
const TARGET = "aarch64-apple-darwin";
const TARBALL_NAME = `node-${VERSION}-darwin-arm64.tar.gz`;
const TARBALL = {
  name: TARBALL_NAME,
  sha256: "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
  url: `https://nodejs.org/dist/${VERSION}/${TARBALL_NAME}`,
};

const SOURCE_NOTE = `node ${VERSION.slice(1)}, the official darwin-arm64 build, unmodified.

Licensed under the MIT licence, with the licences of what it bundles: see LICENSE.

Source: https://github.com/nodejs/node/tree/${VERSION}
`;

const packageRoot = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(packageRoot, ".cache", "bundled-node");
const binaryFile = path.join(packageRoot, "src-tauri", "binaries", `node-${TARGET}`);
const payloadDir = path.join(packageRoot, "resources", "node");
const stagingDir = `${payloadDir}.partial`;

const log = (line) => {
  process.stdout.write(`fetch-node: ${line}\n`);
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

try {
  const tarball = await fetchPinned(TARBALL);
  const top = TARBALL_NAME.replace(/\.tar\.gz$/u, "");
  // staged beside the payload and swapped in whole, so an interrupted run never leaves a half tree
  await rm(stagingDir, { force: true, recursive: true });
  await mkdir(stagingDir, { recursive: true });
  const unpacked = spawnSync(
    "tar",
    ["-xzf", tarball, "-C", stagingDir, `${top}/bin/node`, `${top}/LICENSE`],
    { stdio: "inherit" },
  );
  if (unpacked.status !== 0) {
    throw new Error(`tar -xzf ${tarball} exited ${unpacked.status ?? unpacked.signal}`);
  }
  await mkdir(path.dirname(binaryFile), { recursive: true });
  await copyFile(path.join(stagingDir, top, "bin", "node"), binaryFile);
  await chmod(binaryFile, 0o755);
  await rename(path.join(stagingDir, top, "LICENSE"), path.join(stagingDir, "LICENSE"));
  await rm(path.join(stagingDir, top), { force: true, recursive: true });
  await writeFile(path.join(stagingDir, "SOURCE"), SOURCE_NOTE);
  await rm(payloadDir, { force: true, recursive: true });
  await rename(stagingDir, payloadDir);
  log(`${TARBALL.name} -> ${path.relative(packageRoot, binaryFile)}`);
} catch (error) {
  process.stderr.write(`fetch-node: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
