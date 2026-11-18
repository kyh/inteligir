import path from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const TYPING_BUDGET = "src/typing-budget.test.tsx";

const DOM_SETUP = ["src/test-support/dom-cleanup.ts", "src/test-support/jsdom-stubs.ts"];

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
          // the markdown grammar runs in the phone's WebView and in a Vercel function, whose heap
          // every request its instance serves at once shares, so a quadratic allocation must fail
          // its suite rather than pass on a multi-gigabyte default heap.
          execArgv: ["--max-old-space-size=512"],
          include: ["src/**/*.test.ts"],
          name: "editor",
          // a corpus written through real Plate editors takes 2s alone, and a full run shares the
          // runner's cores with every suite turbo starts beside it, so the 5s default is a
          // coin-flip; parse-cost holds the parse's cost in counted steps, not time.
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
          setupFiles: DOM_SETUP,
          // real Plate trees mount beside every suite turbo starts in a full run; 5s is a coin-flip
          // there.
          testTimeout: 20_000,
        },
      },
      {
        // a 10k-line note mounted in jsdom under React's dev build peaks near 4 GB, past the heap
        // V8 sizes on a small machine; only this suite's worker gets the larger ceiling.
        extends: true,
        plugins: [reactCompiler()],
        test: {
          environment: "jsdom",
          execArgv: ["--max-old-space-size=4096"],
          include: [TYPING_BUDGET],
          name: "editor-budget",
          setupFiles: DOM_SETUP,
          // unmounting a 10k-line tree outlasts the 10s default on a slow runner
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
