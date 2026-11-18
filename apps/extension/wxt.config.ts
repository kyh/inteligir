import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "wxt";
import { z } from "zod";

import product from "../../package.json" with { type: "json" };
import { DEV_CLOUD_ORIGIN, extensionManifest, flavorOfMode } from "./src/manifest";
import { WORKER_CONDITIONS } from "./worker-conditions";

const { version } = product;

const NAMED_FILES = ["background.js", "capture.js", "manifest.json", "popup.html", "welcome.html"];

const fail = (message: string): never => {
  throw new Error(`@repo/extension: ${message}`);
};

const shippedFiles = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();

const vendoredLicences = () =>
  z
    .array(z.object({ path: z.string() }))
    .parse(
      JSON.parse(
        execFileSync(
          "pnpm",
          ["ls", "--json", "--depth", "-1", "--filter-prod", "@repo/extension..."],
          { encoding: "utf-8" },
        ),
      ),
    )
    .flatMap(({ path: dir }) => {
      const texts = path.join(dir, "licenses");

      return existsSync(texts)
        ? readdirSync(texts).map((name) => ({
            absoluteSrc: path.join(texts, name),
            relativeDest: `licenses/${name}`,
          }))
        : [];
    });

const checkStoreZip = (outDir: string, zipPath: string) => {
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
    "build:before": (wxt) => {
      if (flavorOfMode(wxt.config.mode) === "store" && process.env.NODE_ENV !== "production") {
        fail("a store build ships React's production build: run it with NODE_ENV=production");
      }
    },
    "vite:build:extendConfig": (entrypoints, viteConfig) => {
      const group = entrypoints.map((entrypoint) => entrypoint.name).join("-");
      viteConfig.build = { ...viteConfig.build, license: { fileName: `licenses/${group}.md` } };
    },
    "build:publicAssets": (_wxt, files) => {
      files.push(...vendoredLicences());
    },
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
    "zip:extension:done": (wxt, zipPath) => {
      try {
        if (flavorOfMode(wxt.config.mode) !== "store") {
          fail("a zip is the Web Store's: `wxt zip --mode store` (pnpm package:extension)");
        }

        checkStoreZip(wxt.config.outDir, zipPath);
      } catch (error) {
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
  manifest: ({ mode }) => {
    const { manifest_version: _written, ...manifest } = extensionManifest(
      flavorOfMode(mode),
      version,
    );

    return manifest;
  },
  srcDir: "src",
  vite: () => ({
    plugins: [
      viteReact(),
      babel({
        presets: [
          reactCompilerPreset({
            environment: { validateNoDynamicallyCreatedComponentsOrHooks: true },
          }),
        ],
      }),
      tailwindcss(),
    ],
    resolve: { conditions: WORKER_CONDITIONS },
  }),
  zip: { artifactTemplate: "inteligir-extension-{{version}}.zip" },
});
