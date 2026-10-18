import { defineConfig } from "vitest/config";

// resolved from this file: cwd is apps/mobile under vitest but the repo root under knip.
const HERE = import.meta.dirname;

export default defineConfig({
  // the routes import through `@/`, which tsconfig's `paths` maps for Metro and vitest never reads,
  // and share-payload's suite imports a route (`+native-intent.ts`)
  resolve: {
    alias: { "@": `${HERE}/src` },
  },
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 1,
    // the stylesheet's suite compiles as Metro does: react-native-css's ES build imports a named
    // export of the CommonJS `debug`, which node refuses and Vite's interop gives it
    server: { deps: { inline: ["react-native-css"] } },
  },
});
