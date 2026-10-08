import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"];

export default defineConfig({
  extends: [core, react, tanstack, antiSlop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".claude",
    ".codex",
    "*.tsbuildinfo",
    ".tanstack",
  ],
  overrides: [
    {
      // A stand-in for an async port is spelled `async` to match the contract
      // it stands in for, with nothing inside to await.
      files: tests,
      rules: {
        "require-await": "off",
      },
    },
  ],
  rules: {
    // Its message asks for a `// SAFETY:` comment, which admits nothing now that
    // `typescript/consistent-type-assertions` refuses every assertion.
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    // Sequential awaits in loops are deliberate here (ordered writes, rate-limited reads).
    "no-await-in-loop": "off",
    // Both shapes it flags are load-bearing idioms: an exhaustive `switch` over a
    // union with no `default` (the fall-off-the-end is what makes tsc reject the
    // function when a member is added) and `useEffect(() => { if (x) return; …;
    // return cleanup; })`, React's own contract for a conditional cleanup.
    "typescript/consistent-return": "off",
    // No type assertion and no escape comment: parse at the boundary or narrow with a
    // type guard. `as const` asserts no other type and stays legal.
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    // `instanceof Function` discriminates a `string | (() => T)` union now that
    // anti-slop owns the `typeof` spelling; every site checks a value this realm built.
    "unicorn/no-instanceof-builtins": ["error", { exclude: ["Function"] }],
  },
});
