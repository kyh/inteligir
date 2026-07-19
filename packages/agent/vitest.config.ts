import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget (see apps/desktop/vitest.config.ts).
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      // Sources use package-name self-imports (the old lint-fence style);
      // resolve them straight to src so tests never depend on install state.
      "@repo/agent": src,
    },
  },
});
