# `agent/` — pi extensions

Inteligir-specific composition over the pi wrapper (`@repo/backend/server/pi/*`). Each "extension" plugs a third-party capability (connected APIs via the executor, agent-browser, native macOS automation) into pi as a tool.

## The bundle pattern

Every extension default-exports one value:

```ts
// extension.ts
export type PiExtensionBundle = {
  name: string; // log prefix, sort key, matches tool name
  critical?: boolean; // setup failure aborts onboarding (default false)
  setup?: (ctx: ExtensionSetupContext) => Promise<void>; // optional one-time install/seed
  register: (ctx: ExtensionRegisterContext) => ExtensionFactory; // build the pi tool, bound to ctx
};

export type ExtensionRegisterContext = {
  binDir: string; // ~/.inteligir/bin — installed CLIs, on PATH
};

export type ExtensionSetupContext = ExtensionRegisterContext & {
  bundledResourcesDir: string; // packaged assets the extension may copy from
};
```

Two contexts because the phases are different: register runs every agent start, so it only sees long-lived paths. Setup runs once during onboarding and additionally gets `bundledResourcesDir` for copying packaged assets — too late to do that at register time anyway.

Bundles are listed **explicitly** in `bundles.ts` (auto-discovery via `import.meta.glob` was Vite-only; the host library must not require one bundler):

```ts
import browser from "./browser/extension";
import executor from "./executor/extension";
import peekaboo from "./peekaboo/extension";
export const EXTENSION_BUNDLES = [browser, executor, peekaboo].toSorted((a, b) =>
  a.name.localeCompare(b.name),
);
```

`__tests__/bundles.test.ts` fails if a folder on disk is missing from the list.

`setup.ts` then:

1. Builds the appropriate context (`ExtensionSetupContext` for setup, `ExtensionRegisterContext` for register) from Inteligir's paths.
2. Runs each `bundle.setup(ctx)` during `seedResources()` via `runBundleSetups()`.
3. Calls each `bundle.register(ctx)` to produce the `ExtensionFactory` array PiAgent consumes.

## Why this shape

peekaboo and browser are conceptually identical — pi tools backed by a third-party CLI installed from a GitHub release. Bundling them under one shape means:

- Adding an extension is "create one folder + one `bundles.ts` line." No edits to `setup.ts`, `app-effects.ts`, `app-machine.ts`, or tests.
- Bootstrap and tool registration live next to each other instead of split across packages.
- `setup()` failures are isolated by default — a broken install logs and continues; the rest of onboarding still works. Mark a bundle `critical: true` if its setup is genuinely required.

The mechanics of CLI install (GitHub release fetch, sha256 verify or version-check, atomic rename) live in `@repo/backend/server/agent-runtime/install` as a single generic primitive — see the package README. Each bundle just calls it with its own naming convention.

## Adding an extension

1. Create `agent/<name>/extension.ts`.
2. Default-export a `PiExtensionBundle`.
3. If it needs install (binary, config seed, etc.), implement `setup(ctx)`. Must be **idempotent** — runs every SETUP, not just first launch.
4. If it's pure in-process (HTTP, in-process API), omit `setup` entirely.
5. If onboarding genuinely cannot proceed without the integration, set `critical: true`.

6. Add it to `EXTENSION_BUNDLES` in `bundles.ts`.

## Layout

```
agent/
  extension.ts          # PiExtensionBundle + contexts + runBundleSetups + tool-schema validator
  bundles.ts            # the explicit bundle registry
  setup.ts              # orchestrator: seeding, integrations + skills listings
  browser/extension.ts  # Wraps agent-browser CLI (setup installs binary + browser runtime)
  executor/extension.ts # Code mode — surfaces executor's `execute`/`resume` tools (connected APIs, incl. Google Workspace)
  peekaboo/extension.ts # Native macOS automation CLI (setup downloads tarball)
```

The agent edits the user's notes with its native file tools against the `./vault`
symlink, so there's no notes-specific extension. Checkbox delegation is driven
from the UI (main/delegation), not an agent tool.

Single-file extensions live as `<name>/extension.ts` rather than `<name>-tool.ts` so they can grow into a folder without churn.

## Tool schema validation

Every tool's `parameters` TypeBox schema must compile to JSON Schema with `type: "object"` at the root — OpenAI silently rejects `anyOf`/`allOf` parameters and the failure manifests as "the agent never replied." We catch this at startup: `setup.ts` wraps each bundle's `ExtensionFactory` with `buildValidatedFactories` (in `extension.ts`), which proxies `pi.registerTool` through `validateToolParametersSchema`. A bad schema throws with the offending bundle + tool name before the agent talks to the provider.

If you need a discriminated-union shape (different fields per `action`), use a flat `Type.Object` with optional fields + an `action` discriminator, and validate per-case at runtime inside `execute` — see `agent/ui/schema.ts` for the pattern.

## When to use `setup()` vs in-process

- **Has `setup()`**: external CLI binary, seeded config file, anything that touches `~/.config/*` or `~/.inteligir/bin/`. Setup runs before the agent starts; `register(ctx)` can close over paths produced by setup.
- **No `setup()`**: pure JS that talks a protocol (HTTP, local IPC) or wraps a Node API. No install step.

## When to use `critical: true`

Almost never. Default (false) means setup is best-effort and the tool surfaces its own failure later (ENOENT, "binary not installed", etc.). Mark `critical: true` only when:

- The agent literally cannot function without the integration.
- A silent skip would mislead the user into thinking the app is ready when it isn't.

A critical setup failure throws out of `seedResources()` and surfaces as `SETUP_FAIL` in the app state machine.
