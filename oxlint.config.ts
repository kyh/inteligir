import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"];

export default defineConfig({
  extends: [core, react, tanstack, antiSlop],
  ignorePatterns: [...core.ignorePatterns, ".claude", ".codex", "*.tsbuildinfo", ".tanstack"],
  overrides: [
    {
      // The Plate editor's tests stub platejs/react and the host-io singleton at
      // module scope: the module seam is the subject under test.
      files: ["packages/editor/src/**/*.test.ts", "packages/editor/src/**/*.test.tsx"],
      rules: { "anti-slop/no-module-mocking": "off" },
    },
    {
      // A stand-in for an async port is spelled `async` to match the contract
      // it stands in for, with nothing inside to await.
      files: tests,
      rules: {
        "require-await": "off",
      },
    },
    {
      files: ["packages/notes/src/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["node:*", "react", "react-dom", "react/*", "@repo/ui", "@repo/ui/*"],
                message:
                  "@repo/notes is pure and platform-neutral — no node/react/ui imports; callers inject platform capabilities",
              },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    // Sequential awaits in loops are deliberate here (ordered vault writes, rate-limited reads).
    "no-await-in-loop": "off",
    // Both shapes it flags are load-bearing idioms: an exhaustive `switch` over a
    // union with no `default` (the fall-off-the-end is what makes tsc reject the
    // function when a member is added) and `useEffect(() => { if (x) return; …;
    // return cleanup; })`, React's own contract for a conditional cleanup.
    "typescript/consistent-return": "off",
    // `instanceof Function` discriminates a `string | (() => T)` union now that
    // anti-slop owns the `typeof` spelling; every site checks a value this realm built.
    "unicorn/no-instanceof-builtins": ["error", { exclude: ["Function"] }],
  },
});
