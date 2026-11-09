import { defineConfig } from "vitest/config";

// the site's own suites, which render its routes to a string as the Worker's SSR does; the Worker's
// code and its suites are @repo/service's
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
