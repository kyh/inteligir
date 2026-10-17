// emits dist/manifest.json from src/manifest.ts, so the manifest is a function the tests call and
// never a JSON file that drifts from them

import type { Plugin } from "vite";
import { extensionManifest } from "../src/manifest";
import type { ExtensionFlavor } from "../src/manifest";

export const emitExtensionManifest = (flavor: ExtensionFlavor, version: string): Plugin => ({
  generateBundle() {
    this.emitFile({
      fileName: "manifest.json",
      source: `${JSON.stringify(extensionManifest(flavor, version), null, 2)}\n`,
      type: "asset",
    });
  },
  name: "inteligir-extension-manifest",
});
