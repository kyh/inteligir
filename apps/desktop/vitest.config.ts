import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The shell is main-process only: pure policy modules (the navigation guard,
// the deep-link translation, the app origin) driven without an Electron env.
export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Monorepo worker budget: turbo runs the package suites in parallel and
    // uncapped pools exhaust the box.
    maxWorkers: 2,
  },
});
