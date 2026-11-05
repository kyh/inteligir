import { defineConfig } from "vitest/config";

export default defineConfig({
  // the sources import through `@/`, the one spelling in tsconfig's `paths`, which Metro reads and
  // Vite reads here, so the suites resolve what the bundle does
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 1,
    // the stylesheet's suite compiles as Metro does: react-native-css's ES build imports a named
    // export of the CommonJS `debug`, which node refuses and Vite's interop gives it
    server: { deps: { inline: ["react-native-css"] } },
  },
});
