// the pages (popup, welcome) and the service worker; the capture script is its own IIFE build
// (vite.capture.config.ts), since executeScript injects one file and runs no module graph.

import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { nativeHostNameFor } from "./src/manifest";
import { extensionVersion, flavorOfMode } from "./vite/build-flavor";
import { emitExtensionManifest } from "./vite/extension-manifest";

export default defineConfig(({ mode }) => {
  const flavor = flavorOfMode(mode);
  return {
    build: {
      // a background chunk the manifest names by a fixed path; every other file is hashed
      rolldownOptions: {
        input: {
          background: "src/background/background.ts",
          popup: "popup.html",
          welcome: "welcome.html",
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        },
      },
    },
    // the one spelling of the host this build dials, read by src/background/host-name.ts
    define: { __INTELIGIR_NATIVE_HOST__: JSON.stringify(nativeHostNameFor(flavor)) },
    plugins: [
      viteReact({ compiler: true }),
      tailwindcss(),
      emitExtensionManifest(flavor, extensionVersion()),
    ],
  };
});
