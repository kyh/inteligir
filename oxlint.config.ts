import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/test-support/**", "**/*.test.ts", "**/*.test.tsx"];

// A regex, not a group: a group matches gitignore-style, so "react" would also refuse
// "@platejs/react".
const NODE = "^node:";
const REACT = "^react(?:-dom)?(?:/|$)";
const NODE_OR_REACT = "^(?:node:|react(?:-dom)?(?:/|$))";

const NOTES_PURITY =
  "@repo/notes is pure and platform-neutral — no node/react/ui imports; callers inject platform capabilities";

// A test is one of the package's callers, so it may hand the code under test the platform.
const platformPurity = (dir: string, regex: string, message: string) => ({
  excludeFiles: tests,
  files: [`${dir}/src/**`],
  rules: { "no-restricted-imports": ["error", { patterns: [{ message, regex }] }] },
});

export default defineConfig({
  extends: [core, react, tanstack, antiSlop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".agents",
    ".claude",
    ".codex",
    "*.tsbuildinfo",
    ".tanstack",
    ".wxt",
  ],
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
      // ultracite's own test override names `*.test.*` and `__tests__/`, never test-support/, so
      // the stubs and fakes the suites share keep a test's allowances here: a stub's no-op body.
      files: ["**/test-support/**"],
      rules: {
        "no-empty-function": "off",
        "promise/prefer-await-to-then": "off",
      },
    },
    {
      // The server posts to worker threads, never to a window, which is the only target that
      // takes an origin.
      files: ["apps/cli/src/server/**"],
      rules: { "unicorn/require-post-message-target-origin": "off" },
    },
    {
      // Hono's middleware awaits next() to run the rest of the chain, then reads or stamps the
      // response it left; the rule assumes Express's call-and-return callback.
      files: ["apps/cli/src/server/app.ts"],
      rules: { "node/callback-return": "off" },
    },
    platformPurity(
      "packages/agent-runtime",
      REACT,
      "@repo/agent-runtime spawns provider processes, so nothing it exports may pull a process tree into a page; the grammars a client reads live in @repo/domain",
    ),
    platformPurity(
      "packages/contract",
      NODE_OR_REACT,
      "@repo/contract is what both ends compile against: it loads in the desktop page, on node, on workerd and in React Native, so a platform import is a package that stops loading somewhere",
    ),
    platformPurity(
      "packages/domain",
      NODE_OR_REACT,
      "@repo/domain is a zod-only leaf: the thread grammar is parsed on both sides of every wire",
    ),
    platformPurity(
      "packages/editor",
      NODE,
      "@repo/editor imports no node module: it runs in the page, and its headless kits in the fill worker's DOM-shimmed thread (apps/cli/src/server/items/capture/fill/)",
    ),
    platformPurity(
      "apps/extension",
      NODE,
      "@repo/extension runs in the browser: its pages and its service worker reach the Mac only through the native host",
    ),
    platformPurity(
      "apps/mobile-editor",
      NODE,
      "@repo/mobile-editor is a page in the phone's WebView, loaded from file://: nothing but the browser is there",
    ),
    platformPurity(
      "packages/ui",
      NODE,
      "@repo/ui is browser-only, and the Worker's SSR half consumes it as well as the local app",
    ),
    platformPurity(
      "apps/workspace",
      NODE,
      "@repo/workspace is the page: it runs in the shell's WebKit or a browser tab, never in the Node process",
    ),
    {
      files: ["packages/notes/src/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              { message: NOTES_PURITY, regex: NODE_OR_REACT },
              { group: ["@repo/ui", "@repo/ui/*"], message: NOTES_PURITY },
            ],
          },
        ],
      },
    },
    {
      // A test is one of the callers, so it may hand the code under test the platform's bytes.
      excludeFiles: tests,
      files: ["packages/notes/src/**"],
      rules: {
        "no-restricted-globals": [
          "error",
          {
            checkGlobalObject: true,
            globals: [
              {
                message:
                  "@repo/notes names no platform and not every runtime it ships to has crypto; take the random bytes or the id from the caller",
                name: "crypto",
              },
              {
                message: "React Native's URL is not WHATWG; parse with @repo/notes/items/item-url",
                name: "URL",
              },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    // Its message asks for a `// SAFETY:` comment, which admits nothing now that
    // `typescript/consistent-type-assertions` refuses every assertion.
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    // Sequential awaits in loops are deliberate here (ordered vault writes, rate-limited reads).
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
