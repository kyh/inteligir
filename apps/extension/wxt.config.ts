// the extension's build: WXT over src/entrypoints (the service worker, the popup, the welcome page
// and the capture script executeScript injects), the pages under the React Compiler, and the
// manifest src/manifest.ts writes for the build's flavor, which is its mode. `wxt zip --mode store`
// is the Web Store's zip, checked here before anything uploads it. Every module imports what it
// uses (`imports: false`), so no global stands for one.

import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "wxt";

import extensionPackage from "./package.json" with { type: "json" };
import { DEV_CLOUD_ORIGIN, extensionManifest, flavorOfMode } from "./src/manifest";
import { WORKER_CONDITIONS } from "./worker-conditions";

// the extension's version is its package's
const { version } = extensionPackage;

// the files every build ships by name: the manifest names the worker, the popup and the welcome
// page, the worker the capture script
const NAMED_FILES = ["background.js", "capture.js", "manifest.json", "popup.html", "welcome.html"];

const fail = (message: string): never => {
  throw new Error(`@repo/extension: ${message}`);
};

const shippedFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();

// what the store signs: no file naming a checkout's cloud, and the zip holding exactly the build's
// files. Its manifest is extensionManifest("store"), held there by build:manifestGenerated, whose
// key, host and connect page src/manifest.test.ts pins
const checkStoreZip = (outDir: string, zipPath: string): void => {
  const files = shippedFiles(outDir);
  for (const file of NAMED_FILES.filter((named) => !files.includes(named))) {
    fail(`the store build has no ${file}`);
  }
  for (const file of files) {
    if (readFileSync(path.join(outDir, file), "latin1").includes(DEV_CLOUD_ORIGIN)) {
      fail(`the store build's ${file} names ${DEV_CLOUD_ORIGIN}, a checkout's cloud`);
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
    // committed key, so a release check loads the store build under the id the cloud trusts
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
  imports: false,
  // WXT writes manifest_version from its own manifestVersion, 3 for Chrome, and warns over one here
  manifest: ({ mode }) => {
    const { manifest_version: _written, ...manifest } = extensionManifest(
      flavorOfMode(mode),
      version,
    );
    return manifest;
  },
  srcDir: "src",
  vite: () => ({
    plugins: [viteReact(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
    // the worker shares its chunks with the pages, so the bundle takes each package's worker build
    resolve: { conditions: WORKER_CONDITIONS },
  }),
  // the name docs/releasing.md uploads
  zip: { artifactTemplate: "inteligir-extension-{{version}}.zip" },
});
