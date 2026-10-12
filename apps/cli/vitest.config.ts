import { configDefaults, defineConfig } from "vitest/config";

// the workspace UI's own suites under the server they boot in-process (src/workspace/__tests__)
const BOOTED_DOM_SUITES = "src/**/*.booted.test.tsx";
// the workspace UI's modules driven over that server, with nothing rendered
const WORKSPACE_MODULE_SUITES = "src/workspace/**/*.test.ts";

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        test: {
          exclude: [...configDefaults.exclude, BOOTED_DOM_SUITES, WORKSPACE_MODULE_SUITES],
          include: ["src/**/*.test.ts"],
          name: "cli",
        },
      },
      {
        // gated as the page's own suites are: these drive the same modules, rendering nothing
        test: {
          include: [WORKSPACE_MODULE_SUITES],
          name: "workspace",
          setupFiles: ["@repo/workspace/test-support/console-error-gate"],
        },
      },
      {
        // uncompiled, unlike the workspace's own suites: the React Compiler's plugin skips the ssr
        // transform these run under. No console.error gate either: the server logs every refused
        // call by design.
        test: {
          environment: "./src/workspace/__tests__/jsdom-ssr-environment.ts",
          include: [BOOTED_DOM_SUITES],
          name: "workspace-booted",
          setupFiles: [
            "@repo/workspace/test-support/jsdom-stubs",
            "@repo/workspace/test-support/dom-timeouts",
          ],
          // several waits on a real server each, on a runner whose speed swings threefold
          testTimeout: 60_000,
        },
      },
    ],
  },
});
