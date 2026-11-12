import path from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import type { TestProjectInlineConfiguration } from "vitest/config";

const TYPING_BUDGET = "src/typing-budget.test.tsx";

const DOM_CLEANUP = "src/test-support/dom-cleanup.ts";

// The React Compiler, so a component it memoizes wrongly fails a DOM suite rather than only the
// built app. Test files stay uncompiled: a fixture hook minted inside a factory is hoisted to
// module scope with no diagnostic.
const reactCompiler = async () =>
  await babel({
    // the plugin's own default (node_modules and rolldown's runtime), which an exclude replaces
    exclude: [
      /[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/u,
      /\.test\.tsx?$/u,
      /\/test-support\//u,
    ],
    presets: [reactCompilerPreset()],
  });

// a 10k-line note mounted in jsdom under React's dev build peaks near 4 GB, past the heap V8 sizes
// for a 7 GB CI runner; only this suite's worker gets the larger ceiling. Beside the other suites
// on the macOS runner that note swaps, and a keystroke's cost there measures the swap rather than
// the editor, so that job sets SKIP_TYPING_BUDGET and the Linux job holds the budget alone.
const budgetProject: TestProjectInlineConfiguration = {
  extends: true,
  plugins: [reactCompiler()],
  test: {
    environment: "jsdom",
    execArgv: ["--max-old-space-size=4096"],
    include: [TYPING_BUDGET],
    name: "editor-budget",
    setupFiles: [DOM_CLEANUP],
    // unmounting a 10k-line tree outlasts the 10s default on a slow runner
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
};

export default defineConfig({
  // the jsx transform every project takes, kit-parity's @repo/ui .tsx sources under node included
  plugins: [react()],
  resolve: { alias: { "@repo/editor": path.resolve(import.meta.dirname, "src") } },
  test: {
    maxWorkers: 2,
    projects: [
      {
        // no compiler: it would be inert, since it skips the ssr transform a node project runs
        extends: true,
        test: {
          // the markdown grammar runs in the phone's WebView and the cell's isolate, so a quadratic
          // allocation must fail its suite rather than pass on a multi-gigabyte default heap.
          execArgv: ["--max-old-space-size=512"],
          include: ["src/**/*.test.ts"],
          name: "editor",
          // a corpus written through real Plate editors runs near 5s on the Linux runner beside the
          // Workers pool, so the default is a coin-flip; parse-cost's ratios hold the time instead.
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        plugins: [reactCompiler()],
        test: {
          environment: "jsdom",
          exclude: [...configDefaults.exclude, TYPING_BUDGET],
          include: ["src/**/*.test.tsx"],
          name: "editor-dom",
          setupFiles: [DOM_CLEANUP],
          // real Plate trees mount beside the Workers pool; 5s is a coin-flip under a full run.
          testTimeout: 20_000,
        },
      },
      ...(process.env.SKIP_TYPING_BUDGET === "1" ? [] : [budgetProject]),
    ],
  },
});
