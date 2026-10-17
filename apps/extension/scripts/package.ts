// `pnpm package:extension`: builds --mode store into .output/store, zips it to
// .output/inteligir-extension-<version>.zip and writes .output/unpacked, refusing a store manifest
// that carries a key or host permissions. The zip is what the Web Store signs, so it carries no
// key; the unpacked build is the same files with the committed key, so a release check loads the
// store build under the id the app's door names.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEV_NATIVE_HOST_NAME } from "@repo/contract/browser/extension-identity";
import { z } from "zod";
import extensionPackage from "../package.json" with { type: "json" };
import { extensionManifest } from "../src/manifest.ts";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".output");
const store = path.join(output, "store");
const unpacked = path.join(output, "unpacked");
const { version } = extensionPackage;
const zipFile = path.join(output, `inteligir-extension-${version}.zip`);

const fail = (message: string): never => {
  process.stderr.write(`package:extension: ${message}\n`);
  process.exit(1);
};

const run = (command: string, args: readonly string[], cwd: string): void => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited ${String(result.status ?? result.signal)}`);
  }
};

// the fields this refuses on, read as the store would read the file
const storeManifestSchema = z.looseObject({ version: z.string() });

rmSync(output, { force: true, recursive: true });
run("pnpm", ["exec", "vite", "build", "--mode", "store", "--outDir", store], root);
run(
  "pnpm",
  [
    "exec",
    "vite",
    "build",
    "--config",
    "vite.capture.config.ts",
    "--mode",
    "store",
    "--outDir",
    store,
  ],
  root,
);

const manifest = storeManifestSchema.parse(
  JSON.parse(readFileSync(path.join(store, "manifest.json"), "utf-8")),
);
if ("key" in manifest) {
  fail("the store manifest carries a key: the Web Store signs the item with its own");
}
if ("host_permissions" in manifest) {
  fail("the store manifest asks for host permissions: the store build has activeTab alone");
}
if (manifest.version !== version) {
  fail(`the store manifest says ${manifest.version}, and the package ${version}`);
}
for (const file of ["background.js", "capture.js", "popup.html", "welcome.html"]) {
  if (!existsSync(path.join(store, file))) {
    fail(`the store build has no ${file}`);
  }
}
if (readFileSync(path.join(store, "background.js"), "utf-8").includes(DEV_NATIVE_HOST_NAME)) {
  fail(`the store build's worker dials ${DEV_NATIVE_HOST_NAME}, a checkout's door`);
}

// -X: no extra file attributes, so the zip's bytes follow its files alone
run("/usr/bin/zip", ["-X", "-r", zipFile, "."], store);

cpSync(store, unpacked, { recursive: true });
writeFileSync(
  path.join(unpacked, "manifest.json"),
  `${JSON.stringify(extensionManifest("store-unpacked", version), null, 2)}\n`,
);

process.stdout.write(`package:extension: ${zipFile}\npackage:extension: ${unpacked}\n`);
