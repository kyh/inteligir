import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/test-support/**", "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"];

// regexes, not groups: a group matches gitignore-style, so "react" would also refuse "@platejs/react"
const NODE = "^node:";
const NODE_OR_REACT = "^(?:node:|react(?:-dom)?(?:/|$))";
const PANEL_IMPORTS =
  "^(?:node:|react(?:-dom|-native)?(?:/|$)|expo(?:-[^/]+)?(?:/|$)|@expo/|@repo/(?:editor|ui)(?:/|$))";

type ImportPattern =
  | { readonly message: string; readonly regex: string; readonly allowTypeImports?: boolean }
  | { readonly message: string; readonly group: readonly string[] };

// a client reaching the connector's decoration bundles the MCP SDK's node shims, which Metro keeps
const SERVER_ONLY = {
  message: "MCP and OpenAPI meta live in @repo/service alone",
  regex: "^(?:@orpc/(?:mcp|openapi)|@modelcontextprotocol/server)(?:/|$)",
};
// `pnpm dev:web` stops on a module both cloudflare.config.ts and the Worker load
const CONFIG_MODULES = {
  message: "cloudflare.config.ts loads this module: read the value from a binding it declares",
  regex: "(?:^|/)(?:compatibility|fill-queues|agent-limits|cloudflare\\.config)(?:\\.ts)?$",
};
// every other entry of the 0.x Agents SDK is experimental or brings what a thread never runs
const AGENTS_SDK = {
  group: ["agents", "agents/**", "!agents/lifecycle"],
  message: "the Worker imports agents/lifecycle alone",
};
const SERVICE_PLATFORM = {
  message: "@repo/service runs on workerd: take the platform from the runtime or a port",
  regex: NODE_OR_REACT,
};
// only the account's cell names a conversation's or a note's object, so no caller reaches another account's
const THREAD_STUB = {
  message: "only library-do.ts and agent-turns.ts name a conversation's object",
  regex: "(?:^|/)thread-stub(?:\\.ts)?$",
};
const NOTE_STUB = {
  message: "only the cell, account-purge.ts and the note's own door and object name a note",
  regex: "(?:^|/)note-stub(?:\\.ts)?$",
};
// a cold note asks its cell for the seed, so a cell blocked while it awaits a note deadlocks
const NOTE_REENTRY = [
  { message: "the cell never blocks its own events", property: "blockConcurrencyWhile" },
  {
    message: "the cell writes in transactionSync alone (cell-storage.ts)",
    property: "transaction",
  },
];
const THREAD_STUB_CALLERS = [
  "packages/service/src/library/library-do.ts",
  "packages/service/src/agent/agent-turns.ts",
];
const NOTE_STUB_CALLERS = [
  "packages/service/src/library/library-do.ts",
  "packages/service/src/library/account-purge.ts",
  "packages/service/src/note/note-routes.ts",
  "packages/service/src/note/note-do.ts",
];
// Expo's DOM bundle transpiles classes, and oRPC's builder dies under it at boot
const NO_ORPC_IN_PAGE = {
  message: "the editor, @repo/ui and the phone's note page reach no oRPC module",
  regex:
    "^(?:@orpc/|@repo/contract/(?:v1(?:/|$)|refusal-text$|library/(?:library-contract|call-outcome)$))",
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

// an override's options replace the base's, so each restates the repo-wide row
const restrictedImports = (patterns: readonly ImportPattern[]) => [
  "error",
  { patterns: [SERVER_ONLY, ...patterns] },
];
const serviceImports = (...stubs: readonly ImportPattern[]) => [
  "error",
  { patterns: [SERVICE_PLATFORM, CONFIG_MODULES, AGENTS_SDK, ...stubs] },
];
const platformPurity = (dir: string, regex: string, message: string, ...more: ImportPattern[]) => ({
  excludeFiles: tests,
  files: [`${dir}/src/**`],
  rules: { "no-restricted-imports": restrictedImports([{ message, regex }, ...more]) },
});

export default defineConfig({
  extends: [core, react, tanstack, antiSlop],
  options: { reportUnusedDisableDirectives: "error", typeAware: true },
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".agents",
    ".claude",
    ".codex",
    ".tanstack",
    ".wxt",
  ],
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
    platformPurity(
      "packages/contract",
      NODE_OR_REACT,
      "@repo/contract loads on every client and the Worker",
    ),
    platformPurity(
      "packages/editor",
      NODE,
      "@repo/editor runs in pages and headless in the Worker",
      NO_ORPC_IN_PAGE,
    ),
    platformPurity(
      "packages/page-reader",
      NODE_OR_REACT,
      "@repo/page-reader reads over its host's DOM",
    ),
    platformPurity(
      "packages/agent-panel",
      PANEL_IMPORTS,
      "@repo/agent-panel names no platform and no UI",
    ),
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
      files: ["packages/service/src/**"],
      rules: { "no-restricted-imports": ["error", { patterns: [AGENTS_SDK] }] },
    },
    {
      excludeFiles: tests,
      files: ["apps/web/src/**"],
      rules: { "no-restricted-imports": restrictedImports([CONFIG_MODULES, AGENTS_SDK]) },
    },
    {
      excludeFiles: tests,
      files: ["apps/web/src/library/**"],
      rules: {
        "no-restricted-imports": restrictedImports([
          { message: "the library runs in a browser, where no node module loads", regex: NODE },
          CONFIG_MODULES,
          AGENTS_SDK,
        ]),
      },
    },
    {
      // Start's middleware `next` is a continuation, not a Node callback
      files: ["apps/web/src/start.ts"],
      rules: { "node/callback-return": ["error", ["callback", "cb"]] },
    },
    {
      excludeFiles: [...tests, ...THREAD_STUB_CALLERS, ...NOTE_STUB_CALLERS],
      files: ["packages/service/src/**"],
      rules: { "no-restricted-imports": serviceImports(THREAD_STUB, NOTE_STUB) },
    },
    {
      files: ["packages/service/src/library/library-do.ts"],
      rules: { "no-restricted-imports": serviceImports() },
    },
    {
      excludeFiles: NOTE_STUB_CALLERS,
      files: THREAD_STUB_CALLERS,
      rules: { "no-restricted-imports": serviceImports(NOTE_STUB) },
    },
    {
      excludeFiles: THREAD_STUB_CALLERS,
      files: NOTE_STUB_CALLERS,
      rules: { "no-restricted-imports": serviceImports(THREAD_STUB) },
    },
    {
      excludeFiles: [...tests, "packages/service/src/library/library-engine.ts"],
      files: ["packages/service/src/library/**"],
      rules: { "no-restricted-properties": ["error", ...NOTE_REENTRY] },
    },
    {
      files: ["packages/service/src/library/library-engine.ts"],
      rules: { "no-restricted-properties": ["error", NOTE_REENTRY[0]] },
    },
    {
      // the model ships to runtimes without crypto, and React Native's URL is not WHATWG
      excludeFiles: tests,
      files: [
        "packages/contract/src/iso-date.ts",
        "packages/contract/src/items/**",
        "packages/contract/src/knowledge/**",
        "packages/contract/src/library/**",
        "packages/contract/src/text/**",
        "packages/editor/src/formulas/collect-formulas.ts",
        "packages/editor/src/formulas/expression.ts",
        "packages/editor/src/formulas/format-result.ts",
        "packages/editor/src/formulas/formula-meta.ts",
        "packages/editor/src/formulas/resolve-graph.ts",
        "packages/editor/src/items/**",
        "packages/editor/src/knowledge/**",
        "packages/editor/src/markdown/**",
        "packages/editor/src/text/**",
        "packages/service/src/imports/**",
        "packages/service/src/items/**",
        "packages/service/src/knowledge/**",
        "packages/service/src/library/library-queries.ts",
        "packages/service/src/library/library-sql.ts",
        "packages/service/src/library/revert-change.ts",
        "packages/service/src/library/sql-value.ts",
        "packages/service/src/note/turn-log.ts",
        "packages/service/src/text/**",
      ],
      rules: {
        "no-restricted-globals": [
          "error",
          {
            checkGlobalObject: true,
            globals: [
              { message: "take the random bytes or the id from the caller", name: "crypto" },
              { message: "parse with @repo/contract/items/item-url", name: "URL" },
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
