import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import landmines from "ultracite/oxlint/landmines";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/test-support/**", "**/*.test.ts", "**/*.test.tsx"];

const NODE = "^node:";
const NODE_OR_REACT = "^(?:node:|react(?:-dom)?(?:/|$))";

const CLIENT_IMPORTS =
  "^(?:node:|react(?:-dom|-native)?(?:/|$)|expo(?:-[^/]+)?(?:/|$)|@expo/|@repo/(?:editor|ui)(?:/|$))";

type ImportPattern =
  | { readonly message: string; readonly regex: string; readonly allowTypeImports?: boolean }
  | { readonly message: string; readonly group: readonly string[] };

const SERVER_ONLY = {
  message: "MCP and OpenAPI meta live in @repo/service alone",
  regex: "^(?:@orpc/(?:openapi|mcp)|@modelcontextprotocol/server)(?:/|$)",
};

const REACT_OR_UI = "^(?:react(?:-dom)?|@repo/ui)(?:/|$)";

const SERVICE_PLATFORM = {
  message: "@repo/service runs on the server: no DOM and no React",
  regex: REACT_OR_UI,
};

const NO_ORPC_IN_PAGE = {
  message: "the editor, @repo/ui and the phone's note page reach no oRPC module",
  regex: "^(?:@orpc/|@repo/contract/rpc/)",
};

const RPC_FOLDER = "packages/contract/src/rpc/**";

const ORPC_IN_RPC_FOLDER = {
  message: "only packages/contract/src/rpc/ reaches oRPC: a page loads the rest of the contract",
  regex: "^@orpc/|(?:^|/)rpc/",
};

const SUITES_ONLY = {
  message: "only a suite imports test-support/: its fakes reach oRPC and node",
  regex: "(?:^|/)test-support/",
};

const CONTRACT_PLATFORM = {
  message: "@repo/contract loads on every client and the server",
  regex: NODE_OR_REACT,
};

const EDITOR_PLATFORM = {
  message: "@repo/editor runs in pages and headless on the server",
  regex: NODE,
};

const HEADLESS_FOLDER = "packages/editor/src/headless/**";

const HEADLESS_PLATFORM = {
  message: "packages/editor/src/headless/ runs on the server: no React half, stylesheet or node",
  regex:
    "^(?:node:|react(?:-dom)?(?:/|$)|@repo/ui(?:/|$)|lucide-react|katex|pele(?:/|$))|/react$|\\.css$",
};

const HEADLESS_WALL = {
  message: "a headless file reaches another folder by @repo/editor/headless/, never by a climb",
  regex: "(?:^|/)\\.\\./",
};

const HEADLESS_ALONE = {
  group: ["@repo/editor/**", "!@repo/editor/headless/**"],
  message: "the server, the page reader and the import worker load @repo/editor/headless/ alone",
};

const NOTE_PAGE_PLATFORM = {
  allowTypeImports: true,
  message: "the phone's note page has only the browser: no React Native, Expo module or node",
  regex: "^(?:node:|react-native(?:-[^/]+)?(?:/|$)|@react-native/|expo(?:-[^/]+)?(?:/|$)|@expo/)",
};

const NOTE_PAGE_WALL = {
  message: "the phone's note page imports nothing of the app outside page/ (page-host.ts)",
  regex: "^(?:\\.\\./|@/)",
};

const DESKTOP_BRIDGE = "apps/web/src/library/shell/desktop-bridge.ts";

const SHELL_API = {
  message: "only the library's shell/desktop-bridge.ts reaches the Mac app",
  regex: "^@tauri-apps/",
};

const LIBRARY_IMPORTS = [
  { message: "the library runs in a browser, where no node module loads", regex: NODE },
];

const IMPORT_RUN = "apps/web/src/library/import/import-run.ts";

const IMPORT_WORKER_PLATFORM = {
  message: "the import runs in a module worker: no React and no @repo/ui",
  regex: REACT_OR_UI,
};

const NEW_ID = "apps/web/src/library/library/new-id.ts";

const IMPORT_WORKER_WALL = {
  group: ["../**", "!../library/new-id", "./import-run"],
  message:
    "the import worker leaves import/ only for library/new-id.ts, and never loads import-run.ts",
};

const NEW_ID_LEAF = {
  message: "library/new-id.ts, which the import worker loads, imports none of the app's modules",
  regex: "^\\.",
};

// WARNING: an override's options replace the base's, so each no-restricted-imports row restates the repo-wide rows
const restrictedImports = (patterns: readonly ImportPattern[]) => [
  "error",
  { patterns: [SERVER_ONLY, SUITES_ONLY, ...patterns] },
];

const BROWSER_STAND_INS = [
  "apps/extension/src/background/worker.test.ts",
  "apps/web/src/library/desktop-update-banner.test.tsx",
  "apps/web/src/library/desktop-updates.test.tsx",
  "apps/web/src/library/item/item-stages.test.tsx",
  "apps/web/src/library/shell/desktop-bridge.test.tsx",
  "apps/web/src/library/test-support/card-grid-layout.test-utils.ts",
  "apps/web/src/library/workspace.test.tsx",
  "packages/editor/src/block-draggable.test.tsx",
  "packages/editor/src/headless/markdown/parse-cost.test.ts",
  "packages/editor/src/item/note-save.test.ts",
  "packages/editor/src/nodes/diagram-preview.test.tsx",
  "packages/editor/src/run-anchoring.test.tsx",
  "packages/editor/src/scroll-reveal.test.tsx",
  "packages/editor/src/typing-budget.test.tsx",
  "packages/service/src/files/file-release.test.ts",
  "packages/service/src/rpc/v1-rpc.test.ts",
  "packages/ui/src/components/row-pills.test.tsx",
  "packages/ui/src/components/sidebar-rail.test.tsx",
];

const HARNESS_DRIVEN_SUITES = [
  "apps/mobile/src/styles.test.ts",
  "packages/editor/src/formulas/formula-edit.test.tsx",
  "packages/editor/src/formulas/formula-picker.test.tsx",
];

const SLOW_SUITES = {
  "apps/web/src/library/library-layout.test.tsx": 3,
  "packages/editor/src/headless/codec/item-edit.test.ts": 1,
  "packages/editor/src/headless/codec/item-markdown.test.ts": 3,
  "packages/editor/src/headless/codec/link-resolve-oracle.test.ts": 1,
  "packages/editor/src/long-note-chunks.test.tsx": 1,
  "packages/service/src/files/file-store.contract.test.ts": 1,
  "packages/service/src/library/library-imports.test.ts": 1,
  "packages/service/src/library/library-parity.test.ts": 1,
  "packages/service/src/library/library-sweeps.test.ts": 2,
};

const WAITED_OUT = {
  "apps/web/src/library/test-support/dom-cleanup.test-utils.ts": 1,
  "packages/service/src/agent/relay.test.ts": 2,
};

const platformPurity = (dir: string, regex: string, message: string, ...more: ImportPattern[]) => ({
  excludeFiles: tests,
  files: [`${dir}/src/**`],
  rules: { "no-restricted-imports": restrictedImports([{ message, regex }, ...more]) },
});

export default defineConfig({
  extends: [core, react, tanstack, antiSlop, landmines],
  jsPlugins: landmines.jsPlugins,
  options: { reportUnusedDisableDirectives: "error", typeAware: true },
  ignorePatterns: [...(core.ignorePatterns ?? []), ".agents", ".claude", ".codex", ".wxt"],
  overrides: [
    {
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
      files: ["apps/web/agent/tools/web_fetch.ts", "apps/web/agent/tools/web_search.ts"],
      rules: { "unicorn/filename-case": "off" },
    },
    {
      files: ["tools/e2e/**"],
      rules: { "no-empty-pattern": "off", "react-hooks/rules-of-hooks": "off" },
    },
    {
      files: [
        "packages/editor/src/nodes/diagram-preview.test.tsx",
        "packages/editor/src/typing-budget.test.tsx",
      ],
      rules: { "anti-slop/no-module-mocking": "off" },
    },
    {
      files: BROWSER_STAND_INS,
      rules: { "landmines-testing/no-test-doubles": "off" },
    },
    {
      files: HARNESS_DRIVEN_SUITES,
      rules: { "landmines-structure/colocated-tests": "off" },
    },
    {
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
      files: ["packages/editor/src/block-draggable.tsx"],
      rules: { "react/forbid-dom-props": "off" },
    },
    {
      files: tests,
      rules: {
        "no-restricted-imports": ["error", { patterns: [SERVER_ONLY] }],
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
      excludeFiles: [...tests, IMPORT_RUN],
      files: ["apps/web/src/library/import/**"],
      rules: {
        "no-restricted-imports": restrictedImports([
          ...LIBRARY_IMPORTS,
          SHELL_API,
          IMPORT_WORKER_PLATFORM,
          IMPORT_WORKER_WALL,
          HEADLESS_ALONE,
        ]),
      },
    },
    {
      files: [NEW_ID],
      rules: {
        "no-restricted-imports": restrictedImports([
          ...LIBRARY_IMPORTS,
          SHELL_API,
          IMPORT_WORKER_PLATFORM,
          NEW_ID_LEAF,
          HEADLESS_ALONE,
        ]),
      },
    },
    {
      excludeFiles: tests,
      files: ["packages/service/src/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: [SUITES_ONLY, SERVICE_PLATFORM, HEADLESS_ALONE] },
        ],
      },
    },
    {
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
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    "landmines-testing/no-fixed-sleep": ["error", { allow: WAITED_OUT }],
    "landmines-testing/no-flake-masking": ["error", { allow: SLOW_SUITES }],
    "no-restricted-imports": restrictedImports([]),
    "no-await-in-loop": "off",
    "typescript/consistent-return": "off",
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true },
    ],
    "react/jsx-no-constructed-context-values": "off",
    "typescript/no-misused-spread": ["error", { allow: [{ from: "lib", name: "string" }] }],
    "require-await": "off",
    "typescript/require-await": "error",
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    "unicorn/no-instanceof-builtins": ["error", { exclude: ["Function"] }],
  },
});
