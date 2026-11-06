import pluginQuery from "@tanstack/eslint-plugin-query";
import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

const tests = ["**/test-support/**", "**/*.test.ts", "**/*.test.tsx"];
// the suites ultracite's vitest preset lints, as its override names them for this repo's TypeScript
const suites = ["**/*.{test,test-d}.{ts,tsx}"];

// A regex, not a group: a group matches gitignore-style, so "react" would also refuse
// "@platejs/react", and a bare name or one `/*` misses a package's deeper subpaths.
const NODE = "^node:";
const NODE_OR_REACT = "^(?:node:|react(?:-dom)?(?:/|$))";
// the replica engine and the agent's panel run in the Mac's page, the browser tab, the phone's
// Hermes and node's tests: no platform, no UI, and no editor, whose diff3 the engine's host hands
// it as the block merge
const REPLICA_IMPORTS =
  "^(?:node:|react(?:-dom|-native)?(?:/|$)|expo(?:-[^/]+)?(?:/|$)|@expo/|@repo/(?:editor|ui)(?:/|$))";

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
  regex: "(?:^|/)(?:compatibility|fill-queues|agent-limits|cloudflare\\.config)(?:\\.ts)?$",
};

// The Worker runs the built-in agent on the Agents SDK's Lifecycle alone, its job queue and its one
// alarm: every other entry of the package is experimental or brings what a thread never runs (MCP,
// the AI SDK, harnesses), and a bump of a 0.x package is read entry by entry. A group, since a regex
// here has no lookahead to spare the one subpath; gitignore-style, it would also refuse a module
// named `agents`, which the Worker's source does not hold.
const AGENTS_SDK = {
  group: ["agents", "agents/**", "!agents/lifecycle"],
  message: "the Worker imports agents/lifecycle alone (apps/web/src/worker/agent/agent-thread.ts)",
};

// A conversation's object is named only by its account's cell, from a thread its own rows hold, so
// no other caller can create one or reach another account's (apps/web/CLAUDE.md, THE BUILT-IN
// AGENT IS OUR OWN LOOP)
const THREAD_STUB = {
  message:
    "only the account's cell names a conversation's object: library-do.ts and agent-turns.ts reach it",
  regex: "(?:^|/)thread-stub(?:\\.ts)?$",
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

type ImportPattern =
  | { readonly message: string; readonly regex: string }
  | { readonly message: string; readonly group: readonly string[] };

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
  extends: [core, react, tanstack, antiSlop, vitest],
  options: { reportUnusedDisableDirectives: "error", typeAware: true },
  // TanStack Query's own rules, as its docs load them into oxlint; no-void-query-fn reads types a
  // JS plugin is not handed, so the type-aware pass's own rules stand in for it
  jsPlugins: ["@tanstack/eslint-plugin-query"],
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
      // A type-aware rule reads the program's types, and a .js file no tsconfig program includes
      // has none: every value in it is `any`. The repo's JS is the few files a tool loads by name
      // and runs as they stand (Expo's config and plugin, the isolation hook, the preview script
      // the deploy job runs before it sets up the repo's node).
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
      // The Plate editor's tests stub platejs/react and the host-io singleton at
      // module scope: the module seam is the subject under test.
      files: ["packages/editor/src/**/*.test.ts", "packages/editor/src/**/*.test.tsx"],
      rules: { "anti-slop/no-module-mocking": "off" },
    },
    {
      // A stand-in for an async port is spelled `async` to match the contract
      // it stands in for, with nothing inside to await. vitest types its asymmetric matchers
      // (`expect.any`, `expect.stringContaining`, `expect.objectContaining`) `any`, and a suite
      // composes them into the values it compares, so the any-flow rules read every such object as
      // unsafe.
      files: tests,
      rules: {
        "require-await": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-return": "off",
      },
    },
    {
      // ultracite's vitest preset, held to how a suite here is written; a rule's options only
      // reach a file whose override names the plugin
      files: suites,
      plugins: ["vitest"],
      rules: {
        // a helper spelled `expect…` (expectOpaque, expectBudget) asserts, so a test calling it does
        "vitest/expect-expect": [
          "error",
          { assertFunctionNames: ["assert", "assertType", "expect", "expect*", "expectTypeOf"] },
        ],
        // a test walks one flow and claims each step it takes (an account signed up, a turn run,
        // its rows read); cut at five claims, each test would replay the steps before it
        "vitest/max-expects": "off",
        // an afterEach holds every test of its file to one claim, as the agent's suites hold each
        // to the scripted Claude having dropped no thinking block
        "vitest/no-standalone-expect": ["error", { additionalTestBlockFunctions: ["afterEach"] }],
        // `toBe(true)` holds a value to the boolean, where toBeTruthy passes a 1 or a string
        "vitest/prefer-to-be-falsy": "off",
        "vitest/prefer-to-be-truthy": "off",
        // a file of one subject names it in its own name, and a describe around its every test
        // would say it twice
        "vitest/require-top-level-describe": "off",
        // vitest's expect takes the message a failure prints second, which a looped claim names
        // its case with
        "vitest/valid-expect": ["error", { maxArgs: 2 }],
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
    platformPurity(
      "packages/contract",
      NODE_OR_REACT,
      "@repo/contract is what both ends compile against: it loads in the library's page, the extension, the phone's React Native, on workerd and in node's suites, so a platform import is a package that stops loading somewhere",
    ),
    platformPurity(
      "packages/domain",
      NODE_OR_REACT,
      "@repo/domain is a zod-only leaf: its vocabulary is parsed on both sides of every wire",
    ),
    platformPurity(
      "packages/editor",
      NODE,
      "@repo/editor imports no node module: it runs in the page, in the phone's WebView, and headless in the Worker, whose cell reads and writes markdown through its codec",
    ),
    platformPurity(
      "packages/page-reader",
      NODE_OR_REACT,
      "@repo/page-reader reads a page over the DOM its host hands it, in the Worker's fill, the extension's worker and the phone's WebView, so it imports no node module (no socket a page could reach) and no React",
    ),
    platformPurity(
      "packages/library-replica",
      REPLICA_IMPORTS,
      "@repo/library-replica is the replica engine every device runs, so it names no platform: its SQL, clock, ids, transport, socket, staged files and block merge are the ports its host hands it",
    ),
    platformPurity(
      "packages/agent-panel",
      REPLICA_IMPORTS,
      "@repo/agent-panel is the built-in agent's panel as every device reads it, so it names no platform and no UI: the Mac's and the tab's page draw it with @repo/ui, the phone natively",
    ),
    platformPurity(
      "apps/extension",
      NODE,
      "@repo/extension runs in the browser: its pages and its service worker reach the library only through /v1, as every client does",
    ),
    platformPurity(
      "apps/mobile-editor",
      NODE,
      "@repo/mobile-editor is a page in the phone's WebView, loaded from file://: nothing but the browser is there",
    ),
    platformPurity(
      "packages/ui",
      NODE,
      "@repo/ui is browser-only: the library's page, the extension's pages and the site's server-rendered pages draw it",
    ),
    platformPurity(
      "apps/workspace",
      NODE,
      "@repo/workspace is the library's page: it runs in the Mac app's WebKit or a browser tab, where no node module loads",
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
      rules: {
        "no-restricted-imports": ["error", { paths: ORPC_V1_NAMES, patterns: [AGENTS_SDK] }],
      },
    },
    {
      excludeFiles: [...tests, "apps/web/src/worker/**"],
      files: ["apps/web/src/**"],
      rules: { "no-restricted-imports": restrictedImports([CONFIG_MODULES, AGENTS_SDK]) },
    },
    {
      // after the override above, whose options this one replaces for the Worker's own code
      excludeFiles: [
        ...tests,
        "apps/web/src/worker/library/library-do.ts",
        "apps/web/src/worker/agent/agent-turns.ts",
      ],
      files: ["apps/web/src/worker/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          { paths: ORPC_V1_NAMES, patterns: [CONFIG_MODULES, AGENTS_SDK, THREAD_STUB] },
        ],
      },
    },
    {
      // the account's cell, which alone names a conversation's object
      files: [
        "apps/web/src/worker/library/library-do.ts",
        "apps/web/src/worker/agent/agent-turns.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          { paths: ORPC_V1_NAMES, patterns: [CONFIG_MODULES, AGENTS_SDK] },
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
    {
      // A test is one of the hosts, so it may hand the engine the platform's timers and fetch.
      excludeFiles: tests,
      files: ["packages/library-replica/src/**"],
      rules: {
        "no-restricted-globals": [
          "error",
          {
            checkGlobalObject: true,
            globals: [
              "crypto",
              "document",
              "fetch",
              "indexedDB",
              "localStorage",
              "navigator",
              "setInterval",
              "setTimeout",
              "URL",
              "WebSocket",
              "window",
              "XMLHttpRequest",
            ].map((name) => ({
              message:
                "@repo/library-replica names no platform: take the clock, the transport, the socket or the ids from the host's ports (src/replica-ports.ts)",
              name,
            })),
          },
        ],
      },
    },
  ],
  rules: {
    ...pluginQuery.configs.recommended.rules,
    "no-restricted-imports": restrictedImports([]),
    // Its message asks for a `// SAFETY:` comment, which admits nothing:
    // `typescript/consistent-type-assertions` refuses every assertion.
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    // Sequential awaits in loops are deliberate here: the outbox sends its rows oldest first, an
    // export writes its zip's parts in order, an import reads R2 a page at a time, and a suite's or
    // a scenario's steps each wait on the one before.
    "no-await-in-loop": "off",
    // Both shapes it flags are load-bearing idioms: an exhaustive `switch` over a
    // union with no `default` (in a function whose return type excludes
    // undefined, the fall-off-the-end is what makes tsc reject it when a member
    // is added) and `useEffect(() => { if (x) return; …; return cleanup; })`,
    // React's own contract for a conditional cleanup.
    "typescript/consistent-return": "off",
    // A switch with a `default` handles the members it names and says what the rest do; one with
    // none must name every member, which the rule then holds.
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true },
    ],
    // a string spread is its code points, which every such spread here means (offsets, character
    // classes, a cap on characters), and unicorn's prefer-spread asks for it over Array.from; a
    // grapheme split would be Intl.Segmenter's, which none of them wants
    "typescript/no-misused-spread": ["error", { allow: [{ from: "lib", name: "string" }] }],
    // the type-aware rule the presets leave unset; two stay off with them: no-unnecessary-condition,
    // since TypeScript narrows a `let` flag a closure resets (an effect's `live`, a child's
    // `exited`) as though no await could change it, and prefer-optional-chain, which asks
    // `x === null || x.y === null` to be `x?.y === null`, false where x is null
    "typescript/no-unsafe-enum-assignment": "error",
    // No type assertion and no escape comment: parse at the boundary or narrow with a
    // type guard. `as const` asserts no other type and stays legal.
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    // `instanceof Function` discriminates a `string | (() => T)` union, since anti-slop
    // owns the `typeof` spelling; every site checks a value this realm built.
    "unicorn/no-instanceof-builtins": ["error", { exclude: ["Function"] }],
  },
});
