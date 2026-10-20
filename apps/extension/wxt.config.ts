// the extension's build: WXT over src/entrypoints (the service worker, the popup, the welcome page
// and the capture script executeScript injects), the pages under the React Compiler, and the
// manifest src/manifest.ts writes for the build's flavor, which is its mode. `wxt zip --mode store`
// is the Web Store's zip, checked here before anything uploads it.

import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DEV_NATIVE_HOST_NAME } from "@repo/contract/browser/extension-identity";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "wxt";
import { z } from "zod";

import extensionPackage from "./package.json" with { type: "json" };
import { extensionManifest, flavorOfMode, nativeHostNameFor } from "./src/manifest";

// the extension's version is its package's
const { version } = extensionPackage;

// the files every build ships by name: the manifest names the worker and the popup, the worker
// the capture script and the welcome page
const NAMED_FILES = ["background.js", "capture.js", "manifest.json", "popup.html", "welcome.html"];

const fail = (message: string): never => {
  throw new Error(`@repo/extension: ${message}`);
};

const shippedFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();

// the fields the store zip refuses on, read as the store would read the file
const storeManifestSchema = z.looseObject({ version: z.string() });

// what the store signs: no key, since the Web Store signs the item with its own, no host and never
// every site, no file dialing a checkout's door, and the zip holding exactly the build's files
const checkStoreZip = (outDir: string, zipPath: string): void => {
  const manifest = storeManifestSchema.parse(
    JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf-8")),
  );
  if ("key" in manifest) {
    fail("the store manifest carries a key: the Web Store signs the item with its own");
  }
  if ("host_permissions" in manifest || JSON.stringify(manifest).includes("<all_urls>")) {
    fail("the store manifest asks for a host: the store build has activeTab alone");
  }
  const files = shippedFiles(outDir);
  for (const file of NAMED_FILES.filter((named) => !files.includes(named))) {
    fail(`the store build has no ${file}`);
  }
  for (const file of files) {
    if (readFileSync(path.join(outDir, file), "latin1").includes(DEV_NATIVE_HOST_NAME)) {
      fail(`the store build's ${file} dials ${DEV_NATIVE_HOST_NAME}, a checkout's door`);
    }
  }
  const listed = spawnSync("/usr/bin/unzip", ["-Z1", zipPath], { encoding: "utf-8" });
  const zipped = listed.stdout
    .split("\n")
    .filter((line) => line !== "" && !line.endsWith("/"))
    .toSorted();
  if (listed.status !== 0 || !isDeepStrictEqual(zipped, files)) {
    fail(`${zipPath} does not hold exactly the files of ${outDir}`);
  }
};

export default defineConfig({
  hooks: {
    // WXT sets NODE_ENV to the mode when none is set, so `--mode store` alone would ship React's
    // development build; the zip script sets it, and a store build without it stops here
    "build:before": (wxt) => {
      if (flavorOfMode(wxt.config.mode) === "store" && process.env.NODE_ENV !== "production") {
        fail("a store build ships React's production build: run it with NODE_ENV=production");
      }
    },
    // what a build ships is the function its tests call: WXT adds the worker and the popup from
    // the entrypoints, so a manifest that says anything else fails the build (a field WXT leaves
    // undefined is one manifest.json never writes). `wxt` (serve) is let through, since it adds its
    // dev server's CSP, reload command and permissions
    "build:manifestGenerated": (wxt, generated) => {
      if (wxt.config.command !== "build") {
        return;
      }
      const flavor = flavorOfMode(wxt.config.mode);
      const written = Object.fromEntries(
        Object.entries(generated).filter(([, value]) => value !== undefined),
      );
      if (!isDeepStrictEqual(written, extensionManifest(flavor, version))) {
        fail(
          `the ${flavor} build's manifest is not extensionManifest("${flavor}") (src/manifest.ts): ${JSON.stringify(written)}`,
        );
      }
    },
    // a zip is the store's, checked, and beside it the unpacked store build: the same files with the
    // committed key, so a release check loads the store build under the id the app's door names
    "zip:extension:done": (wxt, zipPath) => {
      try {
        if (flavorOfMode(wxt.config.mode) !== "store") {
          fail("a zip is the Web Store's: `wxt zip --mode store` (pnpm package:extension)");
        }
        checkStoreZip(wxt.config.outDir, zipPath);
      } catch (error) {
        // WXT has written the zip under the release's name already, so a refused one goes with it
        rmSync(zipPath, { force: true });
        throw error;
      }
      const unpacked = `${wxt.config.outDir}-unpacked`;
      rmSync(unpacked, { force: true, recursive: true });
      cpSync(wxt.config.outDir, unpacked, { recursive: true });
      writeFileSync(
        path.join(unpacked, "manifest.json"),
        `${JSON.stringify(extensionManifest("store-unpacked", version), null, 2)}\n`,
      );
      wxt.logger.success(`the unpacked store build: ${path.relative(wxt.config.root, unpacked)}`);
    },
  },
  // WXT writes manifest_version from its own manifestVersion, 3 for Chrome, and warns over one here
  manifest: ({ mode }) => {
    const { manifest_version: _written, ...manifest } = extensionManifest(
      flavorOfMode(mode),
      version,
    );
    return manifest;
  },
  srcDir: "src",
  vite: ({ mode }) => ({
    // the one spelling of the host this build dials, read by src/background/host-name.ts
    define: {
      __INTELIGIR_NATIVE_HOST__: JSON.stringify(nativeHostNameFor(flavorOfMode(mode))),
    },
    plugins: [viteReact({ compiler: true }), tailwindcss()],
  }),
  // the name docs/releasing.md uploads
  zip: { artifactTemplate: "inteligir-extension-{{version}}.zip" },
});
