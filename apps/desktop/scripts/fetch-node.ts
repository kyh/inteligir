// The node the packaged app runs its server on, and every node child the server starts: the shell
// is Rust, and a Mac need hold no node of its own. The official build, pinned by sha-256, staged
// where `bundle.externalBin` finds it (src-tauri/binaries/node-<target>, which Tauri places beside
// the shell as Contents/MacOS/node), with its licence in resources/node for
// Contents/Resources/notices/node.

import { chmod, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchPinned, untar } from "./pinned-fetch.ts";
import type { PinnedFile } from "./pinned-fetch.ts";

// held to the major `engines.node` names; a bump re-pins the hash from the release's SHASUMS256.txt
const VERSION = "v24.21.0";
const TARGET = "aarch64-apple-darwin";
const TARBALL_NAME = `node-${VERSION}-darwin-arm64.tar.gz`;
const TARBALL: PinnedFile = {
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

const log = (line: string): void => {
  process.stdout.write(`fetch-node: ${line}\n`);
};

try {
  const tarball = await fetchPinned(TARBALL, { cacheDir, log });
  const top = TARBALL_NAME.replace(/\.tar\.gz$/u, "");
  // staged beside the payload and swapped in whole, so an interrupted run never leaves a half tree
  await rm(stagingDir, { force: true, recursive: true });
  await mkdir(stagingDir, { recursive: true });
  untar(tarball, stagingDir, [`${top}/bin/node`, `${top}/LICENSE`]);
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
