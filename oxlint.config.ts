import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

const tests = ["**/test-support/**", "**/*.test.ts", "**/*.test.tsx"];

// A regex, not a group: a group matches gitignore-style, so "react" would also refuse
// "@platejs/react", and a bare name or one `/*` misses a package's deeper subpaths.
const NODE = "^node:";
const REACT = "^react(?:-dom)?(?:/|$)";
const NODE_OR_REACT = "^(?:node:|react(?:-dom)?(?:/|$))";

const NOTES_PURITY =
  "@repo/notes is pure and platform-neutral — no node/react/ui imports; callers inject platform capabilities";

// The connector's tool decoration is the Worker's alone (apps/web/src/worker/connector): a client
// that reached it would bundle the MCP SDK, whose shims import node:process, and the OpenAPI codec,
// neither of which Metro tree-shakes away.
const SERVER_ONLY = {
  message:
    "MCP and OpenAPI meta live in apps/web/src/worker alone; a client imports @repo/contract's plain rows",
  regex: "^(?:@orpc/(?:mcp|openapi)|@modelcontextprotocol/server)(?:/|$)",
};

// The dev server cannot load a module the Worker's config also loads (`pnpm dev:web` stops on the
// first such import), so the Worker's code takes what it needs of those modules from a binding the
// config declares, as the fill consumer reads FILL_DELIVERY.
const CONFIG_MODULES = {
  message:
    "cloudflare.config.ts loads this module, so the dev server cannot load it in the Worker too: read the value from a binding the config declares",
  regex: "(?:^|/)(?:compatibility|fill-queues|cloudflare\\.config)(?:\\.ts)?$",
};

// oRPC v2 still ships its v1 names, untagged, beside the new ones (https://orpc.dev/docs/migrations/from-v1).
const V1_NAMES_MESSAGE =
  "oRPC v1's name: use v2's (RouterContractClient, InferRouterContractInputs/Outputs, RouterContract, AnyProcedureContract, asyncIteratorObject, PromiseWithError, InferClientError, consumeAsyncIterator)";
const ORPC_V1_NAMES = [
  {
    importNames: [
      "AnyContractProcedure",
      "AnyContractRouter",
      "ContractRouterClient",
      "InferContractRouterErrorMap",
      "InferContractRouterInputs",
      "InferContractRouterOutputs",
      "eventIterator",
      "getContractRouter",
      "minifyContractRouter",
    ],
    message: V1_NAMES_MESSAGE,
    name: "@orpc/contract",
  },
  {
    importNames: [
      "InferRouterCurrentContexts",
      "eventIterator",
      "eventIteratorToStream",
      "eventIteratorToUnproxiedDataStream",
      "streamToEventIterator",
    ],
    message: V1_NAMES_MESSAGE,
    name: "@orpc/server",
  },
  {
    importNames: [
      "ClientPromiseResult",
      "InferClientErrorUnion",
      "consumeEventIterator",
      "eventIteratorToStream",
      "eventIteratorToUnproxiedDataStream",
      "streamToEventIterator",
    ],
    message: V1_NAMES_MESSAGE,
    name: "@orpc/client",
  },
];

interface ImportPattern {
  readonly message: string;
  readonly regex: string;
}

// One rule config per file: an override's options replace the base's rather than add to them, so
// every override restating the rule carries the repo-wide rows beside its own.
const restrictedImports = (patterns: readonly ImportPattern[]) => [
  "error",
  { paths: ORPC_V1_NAMES, patterns: [SERVER_ONLY, ...patterns] },
];

// A test is one of the package's callers, so it may hand the code under test the platform.
const platformPurity = (dir: string, regex: string, message: string) => ({
  excludeFiles: tests,
  files: [`${dir}/src/**`],
  rules: { "no-restricted-imports": restrictedImports([{ message, regex }]) },
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
      "packages/page-reader",
      NODE_OR_REACT,
      "@repo/page-reader reads a page over the DOM its host hands it, in the Mac's network-less fill worker and in the phone's WebView, so it imports no node module (no socket a page could reach) and no React",
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
        "no-restricted-imports": restrictedImports([
          { message: NOTES_PURITY, regex: NODE_OR_REACT },
          { message: NOTES_PURITY, regex: "^@repo/ui(?:/|$)" },
        ]),
      },
    },
    {
      // the one place the library's rows become the connector's tools
      files: ["apps/web/src/worker/**"],
      rules: { "no-restricted-imports": ["error", { paths: ORPC_V1_NAMES }] },
    },
    {
      excludeFiles: [...tests, "apps/web/src/worker/**"],
      files: ["apps/web/src/**"],
      rules: { "no-restricted-imports": restrictedImports([CONFIG_MODULES]) },
    },
    {
      // after the override above, whose options this one replaces for the Worker's own code
      excludeFiles: tests,
      files: ["apps/web/src/worker/**"],
      rules: {
        "no-restricted-imports": ["error", { paths: ORPC_V1_NAMES, patterns: [CONFIG_MODULES] }],
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
    "no-restricted-imports": restrictedImports([]),
    // Its message asks for a `// SAFETY:` comment, which admits nothing now that
    // `typescript/consistent-type-assertions` refuses every assertion.
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    // Sequential awaits in loops are deliberate here (ordered vault writes, rate-limited reads).
    "no-await-in-loop": "off",
    // Both shapes it flags are load-bearing idioms: an exhaustive `switch` over a
    // union with no `default` (in a function whose return type excludes
    // undefined, the fall-off-the-end is what makes tsc reject it when a member
    // is added) and `useEffect(() => { if (x) return; …; return cleanup; })`,
    // React's own contract for a conditional cleanup.
    "typescript/consistent-return": "off",
    // No type assertion and no escape comment: parse at the boundary or narrow with a
    // type guard. `as const` asserts no other type and stays legal.
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    // `instanceof Function` discriminates a `string | (() => T)` union now that
    // anti-slop owns the `typeof` spelling; every site checks a value this realm built.
    "unicorn/no-instanceof-builtins": ["error", { exclude: ["Function"] }],
  },
});
