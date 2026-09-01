import { configDefaults, defineConfig } from "vitest/config";

// Suites that BOOT the server graph inside a DOM test carry the `.booted.`
// marker, so a new one lands in the right project by name alone.
const BOOTED_DOM_SUITES = "src/**/*.booted.test.tsx";

const SETUP_FILES = ["src/renderer/app/__tests__/jsdom-stubs.ts"];

export default defineConfig({
  test: {
    // Budgeted against the rest of the monorepo's suites, which turbo runs in
    // parallel: uncapped pools exhaust the machine and kill workers mid-run.
    maxWorkers: 2,
    projects: [
      {
        test: {
          name: "desktop",
          // node by default (the main-process policy suites); the renderer's
          // component tests opt into jsdom per file via an @vitest-environment
          // docblock.
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: [...configDefaults.exclude, BOOTED_DOM_SUITES],
          setupFiles: SETUP_FILES,
        },
      },
      {
        test: {
          name: "desktop-booted-dom",
          // The builtin jsdom environment transforms every import in "client"
          // mode, where vite rewrites `import.meta.url` to an http URL — and
          // the server graph these suites boot resolves real files from it
          // (`@repo/db/migrate`'s drizzle folder), so the boot dies at import.
          // This environment keeps jsdom's globals with the ssr transform the
          // node suites already run under.
          environment: "./src/renderer/app/actions/__tests__/jsdom-ssr-environment.ts",
          include: [BOOTED_DOM_SUITES],
          setupFiles: SETUP_FILES,
        },
      },
    ],
  },
});
