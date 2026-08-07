import { defineConfig } from "vitest/config";

// Node-only, for the PURE modules. Nothing here imports the `expo-*` /
// react-native wiring, so no device or native module is involved.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/__tests__/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 1,
  },
});
