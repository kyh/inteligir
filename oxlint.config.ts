import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/test-support/**", "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"];

// regexes, not groups: a group matches gitignore-style, so "react" would also refuse "@platejs/react"
const NODE = "^node:";
const NODE_OR_REACT = "^(?:node:|react(?:-dom)?(?:/|$))";
const CLIENT_IMPORTS =
  "^(?:node:|react(?:-dom|-native)?(?:/|$)|expo(?:-[^/]+)?(?:/|$)|@expo/|@repo/(?:editor|ui)(?:/|$))";

type ImportPattern =
  | { readonly message: string; readonly regex: string; readonly allowTypeImports?: boolean }
  | { readonly message: string; readonly group: readonly string[] };

// a client reaching the connector's decoration bundles the MCP SDK's node shims, which Metro keeps
const SERVER_ONLY = {
  message: "MCP and OpenAPI meta live in @repo/service alone",
  regex: "^(?:@orpc/openapi|@modelcontextprotocol/server)(?:/|$)",
};
const SERVICE_PLATFORM = {
  message: "@repo/service runs on the server: no DOM and no React",
  regex: "^(?:react(?:-dom)?|@repo/ui)(?:/|$)",
};
// Expo's DOM bundle transpiles classes, and oRPC's builder dies under it at boot
const NO_ORPC_IN_PAGE = {
  message: "the editor, @repo/ui, the live socket and the phone's note page reach no oRPC module",
  regex: "^(?:@orpc/|@repo/contract/rpc/)",
};
// a page loads the rest of the contract, so a module that reaches oRPC, itself or through
// another, sits in rpc/
const RPC_FOLDER = "packages/contract/src/rpc/**";
const ORPC_IN_RPC_FOLDER = {
  message: "only packages/contract/src/rpc/ reaches oRPC: a page loads the rest of the contract",
  regex: "^@orpc/|(?:^|/)rpc/",
};
const CONTRACT_PLATFORM = {
  message: "@repo/contract loads on every client and the server",
  regex: NODE_OR_REACT,
};
const EDITOR_PLATFORM = {
  message: "@repo/editor runs in pages and headless on the server",
  regex: NODE,
};
// the server and the page reader load the editor's headless folder; a `platejs/react` import from a
// .ts file type-checks and drags React onto the server
const HEADLESS_FOLDER = "packages/editor/src/headless/**";
const HEADLESS_PLATFORM = {
  message: "packages/editor/src/headless/ runs on the server: no React half, stylesheet or node",
  regex:
    "^(?:node:|react(?:-dom)?(?:/|$)|@repo/ui(?:/|$)|lucide-react|katex|pele(?:/|$))|/react$|\\.css$",
};
// a regex cannot count a climb's depth, so a headless file names another folder's by name
const HEADLESS_WALL = {
  message: "a headless file reaches another folder by @repo/editor/headless/, never by a climb",
  regex: "(?:^|/)\\.\\./",
};
// a group, for its negation
const HEADLESS_ALONE = {
  group: ["@repo/editor/**", "!@repo/editor/headless/**"],
  message: "the server and the page reader load @repo/editor/headless/ alone",
};
// the phone's note page runs in its web view and reaches the phone only through its props
const NOTE_PAGE_PLATFORM = {
  allowTypeImports: true,
  message: "the phone's note page has only the browser: no React Native, Expo module or node",
  regex: "^(?:node:|react-native(?:-[^/]+)?(?:/|$)|@react-native/|expo(?:-[^/]+)?(?:/|$)|@expo/)",
};
const NOTE_PAGE_WALL = {
  message: "the phone's note page imports nothing of the app outside page/ (page-host.ts)",
  regex: "^(?:\\.\\./|@/)",
};
// Tauri answers only inside the Mac app's window, so one module checks for it and speaks the shell
const DESKTOP_BRIDGE = "apps/web/src/library/shell/desktop-bridge.ts";
const SHELL_API = {
  message: "only the library's shell/desktop-bridge.ts reaches the Mac app",
  regex: "^@tauri-apps/",
};
const LIBRARY_IMPORTS = [
  { message: "the library runs in a browser, where no node module loads", regex: NODE },
];

// an override's options replace the base's, so each restates the repo-wide row
const restrictedImports = (patterns: readonly ImportPattern[]) => [
  "error",
  { patterns: [SERVER_ONLY, ...patterns] },
];
const platformPurity = (dir: string, regex: string, message: string, ...more: ImportPattern[]) => ({
  excludeFiles: tests,
  files: [`${dir}/src/**`],
  rules: { "no-restricted-imports": restrictedImports([{ message, regex }, ...more]) },
});

export default defineConfig({
  extends: [core, react, tanstack, antiSlop],
  options: { reportUnusedDisableDirectives: "error", typeAware: true },
  ignorePatterns: [...(core.ignorePatterns ?? []), ".agents", ".claude", ".codex", ".wxt"],
  overrides: [
    {
      // no tsconfig program includes the few JS files a tool loads by name, so every value is `any`
      files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
      rules: {
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/prefer-nullish-coalescing": "off",
        "typescript/strict-boolean-expressions": "off",
      },
    },
    {
      // Playwright reads a fixture's needs from its `{}` destructure, and its `use` is no React hook
      files: ["tools/e2e/**"],
      rules: { "no-empty-pattern": "off", "react-hooks/rules-of-hooks": "off" },
    },
    {
      // the editor's suites stub platejs/react and the host-io singleton: the seam is the subject
      files: ["packages/editor/src/**/*.test.ts", "packages/editor/src/**/*.test.tsx"],
      rules: { "anti-slop/no-module-mocking": "off" },
    },
    {
      // an icon-only button shows the product's Tooltip, never the OS's; @repo/ui's Button drops
      // the native title itself
      files: ["packages/editor/**"],
      rules: {
        "react/forbid-dom-props": [
          "error",
          {
            forbid: [
              {
                disallowedFor: ["button"],
                message: "wrap an icon-only button in @repo/ui's <Tooltip> with an aria-label",
                propName: "title",
              },
            ],
          },
        ],
      },
    },
    {
      // the two per-block handles keep the native title: one Tooltip root per block in a long
      // note is a cost nobody measured
      files: ["packages/editor/src/block-draggable.tsx"],
      rules: { "react/forbid-dom-props": "off" },
    },
    {
      // a stub is `async` to match its port, and vitest types its asymmetric matchers `any`
      files: tests,
      rules: {
        "no-empty-function": "off",
        "promise/prefer-await-to-then": "off",
        "typescript/require-await": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-return": "off",
      },
    },
    {
      excludeFiles: [...tests, RPC_FOLDER],
      files: ["packages/contract/src/**"],
      rules: {
        "no-restricted-imports": restrictedImports([CONTRACT_PLATFORM, ORPC_IN_RPC_FOLDER]),
      },
    },
    {
      excludeFiles: tests,
      files: [RPC_FOLDER],
      rules: { "no-restricted-imports": restrictedImports([CONTRACT_PLATFORM]) },
    },
    {
      excludeFiles: [...tests, HEADLESS_FOLDER],
      files: ["packages/editor/src/**"],
      rules: { "no-restricted-imports": restrictedImports([EDITOR_PLATFORM, NO_ORPC_IN_PAGE]) },
    },
    {
      excludeFiles: tests,
      files: [HEADLESS_FOLDER],
      rules: {
        "no-restricted-imports": restrictedImports([
          HEADLESS_PLATFORM,
          HEADLESS_WALL,
          HEADLESS_ALONE,
          NO_ORPC_IN_PAGE,
        ]),
      },
    },
    platformPurity(
      "packages/page-reader",
      NODE_OR_REACT,
      "@repo/page-reader reads over its host's DOM",
      HEADLESS_ALONE,
    ),
    platformPurity("packages/client", CLIENT_IMPORTS, "@repo/client names no platform and no UI"),
    {
      // the editor dials a note on it, inside the phone's note page
      files: ["packages/client/src/live-socket.ts"],
      rules: {
        "no-restricted-imports": restrictedImports([
          { message: "@repo/client names no platform and no UI", regex: CLIENT_IMPORTS },
          NO_ORPC_IN_PAGE,
        ]),
      },
    },
    platformPurity("apps/extension", NODE, "@repo/extension runs in the browser"),
    platformPurity("packages/ui", NODE, "@repo/ui is browser-only", NO_ORPC_IN_PAGE),
    {
      excludeFiles: tests,
      files: ["apps/mobile/src/editor/page/**"],
      rules: {
        "no-restricted-imports": restrictedImports([
          NOTE_PAGE_PLATFORM,
          NOTE_PAGE_WALL,
          NO_ORPC_IN_PAGE,
        ]),
      },
    },
    {
      excludeFiles: [...tests, "apps/mobile/src/editor/page/**"],
      files: ["apps/mobile/src/**"],
      rules: {
        "no-restricted-imports": restrictedImports([
          {
            message: "only the phone's note page (src/editor/page/) draws DOM",
            regex: "^(?:@repo/(?:editor|ui)(?:/|$)|react-dom(?:/|$))",
          },
        ]),
      },
    },
    {
      excludeFiles: tests,
      files: ["apps/web/src/**"],
      rules: { "no-restricted-imports": restrictedImports([SHELL_API]) },
    },
    {
      excludeFiles: [...tests, DESKTOP_BRIDGE],
      files: ["apps/web/src/library/**"],
      rules: { "no-restricted-imports": restrictedImports([...LIBRARY_IMPORTS, SHELL_API]) },
    },
    {
      files: [DESKTOP_BRIDGE],
      rules: { "no-restricted-imports": restrictedImports(LIBRARY_IMPORTS) },
    },
    {
      // MCP and OpenAPI meta are this package's, so the repo-wide row is left out
      excludeFiles: tests,
      files: ["packages/service/src/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [SERVICE_PLATFORM, HEADLESS_ALONE] }],
      },
    },
    {
      // the model ships to runtimes without crypto
      excludeFiles: tests,
      files: [
        "packages/contract/src/iso-date.ts",
        "packages/contract/src/items/**",
        "packages/contract/src/knowledge/**",
        "packages/contract/src/library/**",
        "packages/contract/src/rpc/call-outcome.ts",
        "packages/contract/src/rpc/library-contract.ts",
        "packages/contract/src/text/**",
        "packages/editor/src/headless/formulas/displays.ts",
        "packages/editor/src/headless/formulas/expression.ts",
        "packages/editor/src/headless/formulas/format-result.ts",
        "packages/editor/src/headless/items/**",
        "packages/editor/src/headless/knowledge/**",
        "packages/editor/src/headless/markdown/**",
        "packages/editor/src/headless/text/**",
      ],
      rules: {
        "no-restricted-globals": [
          "error",
          {
            checkGlobalObject: true,
            globals: [
              { message: "take the random bytes or the id from the caller", name: "crypto" },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    "no-restricted-imports": restrictedImports([]),
    // ordered awaits are deliberate: the outbox sends oldest first, an import pages R2
    "no-await-in-loop": "off",
    // it flags the exhaustive switch with no default, whose fall-through is what tsc checks
    "typescript/consistent-return": "off",
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true },
    ],
    // the React Compiler memoizes a context's value, as it does every value it compiles
    "react/jsx-no-constructed-context-values": "off",
    // a string spread here means its code points
    "typescript/no-misused-spread": ["error", { allow: [{ from: "lib", name: "string" }] }],
    "require-await": "off",
    "typescript/require-await": "error",
    // owner decision: no type assertion, and no escape comment
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    // anti-slop owns `typeof`, so `instanceof Function` narrows a `string | (() => T)`
    "unicorn/no-instanceof-builtins": ["error", { exclude: ["Function"] }],
  },
});
