import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 1,
    server: { deps: { inline: ["react-native-css"] } },
  },
});
