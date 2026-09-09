import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"];

export default defineConfig({
  extends: [core, react, tanstack, antiSlop],
  ignorePatterns: [...core.ignorePatterns, ".claude", ".codex", "*.tsbuildinfo", ".tanstack"],
  // The type-aware rules the presets list only run with this on; it spawns the
  // `oxlint-tsgolint` devDependency. Every @repo/* exports TS source, so there
  // is no build to stage first.
  options: { typeAware: true },
  overrides: [
    {
      // The Plate editor's tests stub platejs/react and the host-io singleton at
      // module scope: the module seam is the subject under test.
      files: ["packages/editor/src/**/*.test.ts", "packages/editor/src/**/*.test.tsx"],
      rules: { "anti-slop/no-module-mocking": "off" },
    },
    {
      // A test builds the shapes production code receives from the wire, so it
      // asserts where production parses; `expect(fake.method)` reads a member
      // detached, which is the assertion.
      files: tests,
      rules: {
        "typescript/consistent-type-assertions": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/unbound-method": "off",
      },
    },
    {
      // Plain JS sits in no tsconfig program, so oxlint-tsgolint types every
      // value as `error` and the unsafe-* family flags each line unconditionally.
      files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
      rules: {
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/strict-boolean-expressions": "off",
        "typescript/strict-void-return": "off",
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
