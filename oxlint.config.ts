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
// the agent's panel runs in the Mac's page, the browser tab, the phone's Hermes and node's tests:
// no platform, no UI and no editor, since the phone draws it natively
const PANEL_IMPORTS =
  "^(?:node:|react(?:-dom|-native)?(?:/|$)|expo(?:-[^/]+)?(?:/|$)|@expo/|@repo/(?:editor|ui)(?:/|$))";

// The connector's tool decoration is the Worker's alone (packages/service/src/connector): a client
// that reached it would bundle the MCP SDK, whose shims import node:process, and the OpenAPI codec,
// neither of which Metro tree-shakes away.
const SERVER_ONLY = {
  message:
    "MCP and OpenAPI meta live in @repo/service alone; a client imports @repo/contract's plain rows",
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
  message: "the Worker imports agents/lifecycle alone (packages/service/src/agent/agent-thread.ts)",
};

// The Worker's code imports no node module and no React. A test is one of its callers, so it may
// hand the code under test the platform.
const SERVICE_PLATFORM = {
  message:
    "@repo/service runs on workerd, and its model's pure suites under node: it takes the platform from the runtime or through a port, never a node or React import",
  regex: NODE_OR_REACT,
};

// A conversation's object is named only by its account's cell, from a thread its own rows hold, so
// no other caller can create one or reach another account's (packages/service/CLAUDE.md, THE
// BUILT-IN AGENT IS OUR OWN LOOP)
const THREAD_STUB = {
  message:
    "only the account's cell names a conversation's object: library-do.ts and agent-turns.ts reach it",
  regex: "(?:^|/)thread-stub(?:\\.ts)?$",
};

// An item's note is named only by its account's cell, for an item its rows hold, and by the note's
// own door once the cell said how it opens (packages/service/CLAUDE.md, EACH NOTE'S BODY IS A LIVE
// DOCUMENT IN AN OBJECT OF ITS OWN)
const NOTE_STUB = {
  message:
    "only the account's cell names an item's note: library-do.ts, account-purge.ts and the note's own door and object reach it",
  regex: "(?:^|/)note-stub(?:\\.ts)?$",
};

// A cold note's load asks its cell for the seed, so a cell blocked on its own events while it
// awaits a note waits on itself forever
const NOTE_REENTRY = [
  {
    message:
      "the cell never blocks its own events: a note it awaits calls back into it (object-schema.ts's openWithSchema migrates)",
    property: "blockConcurrencyWhile",
  },
  {
    message:
      "the cell writes in transactionSync alone (cell-storage.ts): an async transaction holds the cell while a note it awaits calls back into it",
    property: "transaction",
  },
];

// the files that reach a conversation's object, and those that reach an item's note
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

// The phone's DOM component is a Metro DOM bundle, which Expo compiles with classes transpiled to
// functions, and oRPC's builder dies under that at boot ("Cannot call a class as a function") while
// typecheck and export stay green. Every module of @repo/contract that reaches oRPC is named.
const NO_ORPC_IN_PAGE = {
  message:
    "the phone's DOM bundle transpiles classes and oRPC's builder dies under it: the editor and @repo/ui reach no oRPC module (NEEDS_CONNECTION is @repo/contract/needs-connection)",
  regex:
    "^(?:@orpc/|@repo/contract/(?:v1(?:/|$)|refusal-text$|library/(?:library-contract|call-outcome)$))",
};

type ImportPattern =
  | { readonly message: string; readonly regex: string; readonly allowTypeImports?: boolean }
  | { readonly message: string; readonly group: readonly string[] };

// The phone's note is a DOM component (apps/mobile/src/editor/page/): a page in its web view, where
// only the browser is, reaching the phone through its props alone. A type import is erased from the
// bundle, so the page may name expo/dom's prop types.
const NOTE_PAGE_PLATFORM = {
  allowTypeImports: true,
  message:
    "the phone's note page runs in its web view, where only the browser is: no React Native, Expo module or node",
  regex: "^(?:node:|react-native(?:-[^/]+)?(?:/|$)|@react-native/|expo(?:-[^/]+)?(?:/|$)|@expo/)",
};
const NOTE_PAGE_WALL = {
  message:
    "the phone's note page reaches the phone only through its props (page-host.ts), so it imports nothing of the app outside page/",
  regex: "^(?:\\.\\./|@/)",
};

// One rule config per file: an override's options replace the base's rather than add to them, so
// every override restating the rule carries the repo-wide rows beside its own.
const restrictedImports = (patterns: readonly ImportPattern[]) => [
  "error",
  { paths: ORPC_V1_NAMES, patterns: [SERVER_ONLY, ...patterns] },
];

// the Worker's code, which holds the connector's meta SERVER_ONLY keeps from a client, with the stubs
// a file may not name
const serviceImports = (...stubs: readonly ImportPattern[]) => [
  "error",
  { paths: ORPC_V1_NAMES, patterns: [SERVICE_PLATFORM, CONFIG_MODULES, AGENTS_SDK, ...stubs] },
];

// A test is one of the package's callers, so it may hand the code under test the platform.
const platformPurity = (
  dir: string,
  regex: string,
  message: string,
  ...more: readonly ImportPattern[]
) => ({
  excludeFiles: tests,
  files: [`${dir}/src/**`],
  rules: { "no-restricted-imports": restrictedImports([{ message, regex }, ...more]) },
});

export default defineConfig({
  extends: [core, react, tanstack, antiSlop, vitest],
  options: { reportUnusedDisableDirectives: "error", typeAware: true },
  // TanStack Query's own rules, as its docs load them into oxlint
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
      // and runs as they stand (Expo's config and plugin, the preview script
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
        "typescript/require-await": "off",
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
      "packages/editor",
      NODE,
      "@repo/editor imports no node module: it runs in the page, in the phone's DOM component, and headless in the Worker, whose cell reads and writes markdown through its codec",
      NO_ORPC_IN_PAGE,
    ),
    platformPurity(
      "packages/page-reader",
      NODE_OR_REACT,
      "@repo/page-reader reads a page over the DOM its host hands it, in the Worker's fill and the extension's worker, so it imports no node module (no socket a page could reach) and no React",
    ),
    platformPurity(
      "packages/agent-panel",
      PANEL_IMPORTS,
      "@repo/agent-panel is the built-in agent's panel as every device reads it, so it names no platform and no UI: the Mac's and the tab's page draw it with @repo/ui, the phone natively",
    ),
    platformPurity(
      "apps/extension",
      NODE,
      "@repo/extension runs in the browser: its pages and its service worker reach the library only through /v1, as every client does",
    ),
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
      // the phone's screens draw natively; the editor and @repo/ui are DOM, drawn only by the note's
      // DOM component, which Expo bundles apart
      excludeFiles: [...tests, "apps/mobile/src/editor/page/**"],
      files: ["apps/mobile/src/**"],
      rules: {
        "no-restricted-imports": restrictedImports([
          {
            message:
              "only the phone's note page (src/editor/page/) draws DOM: a native screen imports no @repo/editor, @repo/ui or react-dom",
            regex: "^(?:@repo/(?:editor|ui)(?:/|$)|react-dom(?:/|$))",
          },
        ]),
      },
    },
    platformPurity(
      "packages/ui",
      NODE,
      "@repo/ui is browser-only: the library's page, the extension's pages and the site's server-rendered pages draw it",
      NO_ORPC_IN_PAGE,
    ),
    {
      // the one place the library's rows become the connector's tools
      files: ["packages/service/src/**"],
      rules: {
        "no-restricted-imports": ["error", { paths: ORPC_V1_NAMES, patterns: [AGENTS_SDK] }],
      },
    },
    {
      excludeFiles: tests,
      files: ["apps/web/src/**"],
      rules: { "no-restricted-imports": restrictedImports([CONFIG_MODULES, AGENTS_SDK]) },
    },
    {
      // after the site's, whose options this one replaces for the library's code
      excludeFiles: tests,
      files: ["apps/web/src/library/**"],
      rules: {
        "no-restricted-imports": restrictedImports([
          {
            message:
              "the library runs in the Mac app's WebKit or a browser tab, where no node module loads",
            regex: NODE,
          },
          CONFIG_MODULES,
          AGENTS_SDK,
        ]),
      },
    },
    {
      // Start's request middleware hands `next` a context and gets the answer back to wrap: a
      // continuation, not the Node callback the rule's default list names it as
      files: ["apps/web/src/start.ts"],
      rules: { "node/callback-return": ["error", ["callback", "cb"]] },
    },
    {
      // after the first of these overrides, whose options this one replaces for the Worker's code
      excludeFiles: [...tests, ...THREAD_STUB_CALLERS, ...NOTE_STUB_CALLERS],
      files: ["packages/service/src/**"],
      rules: { "no-restricted-imports": serviceImports(THREAD_STUB, NOTE_STUB) },
    },
    {
      // the account's cell, which alone names a conversation's object and an item's note
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
      // the cell's code, every module of which may await a note; its engine, which never awaits,
      // alone calls the synchronous port's `transaction`
      excludeFiles: [...tests, "packages/service/src/library/library-engine.ts"],
      files: ["packages/service/src/library/**"],
      rules: { "no-restricted-properties": ["error", ...NOTE_REENTRY] },
    },
    {
      files: ["packages/service/src/library/library-engine.ts"],
      rules: { "no-restricted-properties": ["error", NOTE_REENTRY[0]] },
    },
    {
      // A test is one of the callers, so it may hand the code under test the platform's bytes.
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
              {
                message:
                  "the library's model names no platform and not every runtime it ships to has crypto; take the random bytes or the id from the caller",
                name: "crypto",
              },
              {
                message:
                  "React Native's URL is not WHATWG; parse with @repo/contract/items/item-url",
                name: "URL",
              },
            ],
          },
        ],
      },
    },
  ],
  rules: {
    ...pluginQuery.configs.recommended.rules,
    // it reads the queryFn's type from the TypeScript program ESLint's parser hands a rule, which
    // oxlint hands no JS plugin, so it never fires; a queryFn that resolves undefined fails its
    // query at once instead, logging a console.error, which fails a workspace suite
    "@tanstack/query/no-void-query-fn": "off",
    "no-restricted-imports": restrictedImports([]),
    // Its message asks for a `// SAFETY:` comment, which admits nothing:
    // `typescript/consistent-type-assertions` refuses every assertion.
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    // Sequential awaits in loops are deliberate here: the outbox sends its rows oldest first, an
    // import reads R2 a page at a time, and a suite's or a scenario's steps each wait on the one
    // before.
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
    // it asks every parameter's type to be deeply readonly, which the types a library hands a
    // callback are not (React's events, DOM nodes, Plate's editor, zod's outputs): hundreds of
    // findings in the library's model and the page alone, nearly all on a library's type
    "typescript/prefer-readonly-parameter-types": "off",
    // the typed rule in place of the base one, which reports the same functions untyped
    "require-await": "off",
    "typescript/require-await": "error",
    // No type assertion and no escape comment: parse at the boundary or narrow with a
    // type guard. `as const` asserts no other type and stays legal.
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    // `instanceof Function` discriminates a `string | (() => T)` union, since anti-slop
    // owns the `typeof` spelling; every site checks a value this realm built.
    "unicorn/no-instanceof-builtins": ["error", { exclude: ["Function"] }],
  },
});
