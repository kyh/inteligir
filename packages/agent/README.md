# @repo/agent

The pi coding-agent capability: the `Agent` lifecycle wrapper, extension
bundles, provider auth, setup/seeding, the faux stub provider, and the pi
harness quarantine.

## Why it exists

Runs in the desktop node host only. Deps: `@repo/bridge` + `@repo/installer` +
`@repo/notes` — never `@repo/server`, `@repo/connectors`, `@repo/storage`, or
electron (package facts: no dep edges). The host composes, agent receives: the
composition root (`@repo/server` `boot/agent-wiring.ts`) injects `AgentPorts`.
It is its own package so everything pi-shaped stays quarantined behind
`src/pi/*` — a future harness swap is a bounded refactor (`src/pi/README.md`
is the Harness contract: the six seams any replacement must satisfy).

## Layout

```
src/
  pi/                   # harness quarantine — the ONLY place @earendil-works/pi*
                        #   may be imported: agent.ts (PiAgent), auth.ts (ModelRuntime
                        #   + OAuth), model.ts (neutral ModelSelection → pi Model),
                        #   pi-types.ts, skills.ts; README.md = the Harness contract
  agent.ts              # Agent — lazy wrapper over PiAgent; session-dir/allowlist/
                        #   ephemeral options; bad model selection rejects start()
  auth.ts               # provider-parametric creds over the ONE shared ModelRuntime;
                        #   auth-epoch undoes OAuth completions that outlive a RESET
  extension.ts          # PiExtensionBundle + AgentPorts + runBundleSetups +
                        #   validateToolParametersSchema / buildValidatedFactories
  bundles.ts            # explicit registry: browser, code-mode, knowledge-tools,
                        #   peekaboo, privacy (one folder + one line to add)
  browser/  peekaboo/   # CLI-backed tools (agent-browser, native macOS automation)
  code-mode/            # execute/resume over the executor daemon (ports.executor)
  knowledge-tools/      # search_vault, get_backlinks, related_notes, rename_note
  privacy/              # gate.ts (pure decision core) + extension.ts (tool_call
                        #   hook) + pi-path-parity.ts (pi's path resolution, replicated)
  provider/faux-provider.ts  # pi-ai faux stub behind INTELIGIR_FAUX_AGENT
  setup.ts              # seeding, integrations list/repair, skills listing
  paths.ts              # ~/.inteligir paths, SESSION_DIR_SEGMENTS, configurePaths()
  text-turn.ts          # runTextTurn — shared single-text-turn mechanics
resources/agent/        # bundled AGENTS.md + skills, seeded into ~/.inteligir
```

## Invariants

- **pi quarantine**: `@earendil-works/pi*` imports are legal only in `src/pi/*`,
  `provider/faux-provider.ts`, and two named tests — `pi-quarantine.test.ts`
  sweeps every `packages/*/src` + `apps/*/src` (dirs derived from disk, no
  hand list) and fails on any other import.
- **Privacy gate is fail-closed** (`docs/privacy.md`): pi's blockable
  `tool_call` hook runs before EVERY tool of both agents; read/edit/write on
  in-vault docs get a LIVE frontmatter probe per call (index never trusted);
  a throwing handler still blocks. bash/execute/browser/peekaboo get a
  best-effort literal-path screen ONLY — not a security boundary.
- **Path parity**: the gate resolves path args with a line-for-line replica of
  pi's unexported path-utils (`privacy/pi-path-parity.ts`) — resolving the raw
  string was a confirmed bypass (`@vault/…`, NBSP filenames). Touch only in
  lockstep with the drift battery; re-verify per pi version bump.
- **Checkpoint seam**: allowed in-vault doc writes capture an undo point
  strictly after privacy allows and before pi executes; a capture failure
  blocks the write (no AI edit without an undo point).
- **Tool schemas** must compile to top-level `type: "object"` — providers
  silently reject `anyOf`/`allOf` roots; `buildValidatedFactories` throws at
  registration, naming bundle + tool.
- Bundle `setup()` is idempotent and best-effort by default; `critical: true`
  surfaces as SETUP_FAIL. Registry ↔ disk drift pinned by `bundles.test.ts`.
- Every pi session dir must appear in `SESSION_DIR_SEGMENTS` or its transcripts
  (note content) stay world-readable — `hardenAppDir` sweeps only that list
  (CLAUDE.md § Decisions: `~/.inteligir` owner-only; pi's auth.json stays
  pi-owned, plaintext-but-0600 by design — no cipher-injection seam).
- **faux fails closed**: `isFauxAgentEnabled()` requires dev-flags-allowed
  (unpackaged) builds; a packaged install refuses `INTELIGIR_FAUX_AGENT`.

## Seams

- `AgentPorts = { executor, knowledge, privacy, checkpoints }` — built by
  `@repo/server` `boot/agent-wiring.ts` over the host singletons and handed to
  bundles at register/setup time. `checkpoints` is null for the background
  delegation session (its undo is the pre-run snapshot).
- `selectModel: () => ModelSelection` — a host-composed neutral
  `(provider, modelId)` thunk; resolved to pi's Model inside `start()`.
- `BundledResources` + `onProgress` — the shell resolves packaged assets and
  the onboarding progress sink; injected through `boot/agent-wiring.ts`.
- `configurePaths()` — must run at process startup, before any pi module loads.

## Testing

`pnpm --filter @repo/agent test` — notable suites: `pi-quarantine.test.ts`
(repo-wide import fence), `pi-path-parity.test.ts` (adversarial battery vs
pi's REAL installed path-utils — upgrade drift fails loudly),
`privacy-gate.test.ts` (decision matrix, fail-closed branches, checkpoint
seam), `bundles.test.ts` (registry/disk drift), `model-selection.test.ts`
(bad selections reject `start()`, never construction), plus extension
(setup/validation) and faux-provider suites.
