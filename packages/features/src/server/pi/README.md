# `server/pi` — the pi quarantine, and the Harness contract

This directory is the ONLY place product code may import `@mariozechner/pi*`
(pi-coding-agent / pi-ai). The fence is test-enforced —
`server/__tests__/pi-quarantine.test.ts` — with exactly three exceptions:
`server/provider/faux-provider.ts` (pi-ai's stub provider; lives in
`provider/` because it is part of the provider menu, but it is pi-shaped) and
two tests (`server/__tests__/pi-path-parity.test.ts`,
`server/provider/__tests__/faux-provider.test.ts`). Everything else — `agent/*`,
the Bridge handlers, delegation, the entire renderer — speaks only to the
wrappers here:

| file          | wraps                                                   |
| ------------- | ------------------------------------------------------- |
| `agent.ts`    | `PiAgent` — session lifecycle over `createAgentSession` |
| `auth.ts`     | `AuthStorage` construction + OAuth login/logout         |
| `model.ts`    | `ModelSelection` (neutral) → pi-ai `Model` resolution   |
| `pi-types.ts` | type re-exports, so an upstream move touches one file   |
| `skills.ts`   | skill listing from the agent dir                        |

## The Harness contract

"Harness" = the coding-agent framework under the product. Today it is pi.
A second harness (Claude Agent SDK, Codex, …) is **DEFERRED — do not build a
`Harness` interface for one implementation** (a one-implementation interface
is just pi with indirection; the real shape is dictated by the second
implementation's constraints — see #460's re-scope). This section is the map
that makes a future swap a bounded refactor instead of a rewrite: the six
seams any replacement must satisfy.

1. **Model resolution.** The host composes a neutral
   `ModelSelection = { provider, modelId }` (the shape the provider-config
   store holds); the wrapper resolves it to the framework's model object
   inside `start()` (`model.ts::resolveModelSelection`). Contract: a bad
   selection rejects the async `start()` path, never construction (pinned in
   `server/__tests__/model-selection.test.ts`). Framework model types must
   not cross the `agent/` seam.

2. **Token custody / AuthStorage.** Provider OAuth credentials live on-device
   in `~/.inteligir/auth.json`, owned by the harness (pi reads it directly
   during token refresh — plaintext-but-0600 by design, see CLAUDE.md
   § Decisions). A replacement needs the same story: interactive OAuth login,
   `hasAuth`-style probes (`agent/auth.ts` composes them), logout that
   removes one provider's credential, and a runtime-only key injection
   (the faux path uses `setRuntimeApiKey`).

3. **`tool_call` interception — THE HARDEST REQUIREMENT.** The fail-closed
   private-note boundary (`agent/privacy/`) hangs off pi's blockable
   per-call `tool_call` hook: the handler runs before EVERY tool executes,
   can block with a reason the model sees as an error tool result, and a
   THROWING handler still blocks (fail-closed by construction). The chat
   undo seam rides the same hook (checkpoint capture strictly after privacy
   allows, strictly before the tool runs). Two hard sub-requirements:
   (a) a harness that cannot intercept every tool call before execution
   breaks the privacy contract (`docs/privacy.md`) — that is disqualifying,
   not a degraded mode; (b) the gate resolves path arguments EXACTLY as the
   harness's own tools do (`agent/privacy/pi-path-parity.ts` mirrors pi's
   expandPath/cwd semantics) — a replacement needs the same parity work
   against its tool implementations, re-verified per version bump.

4. **Streaming events.** The app consumes exactly eight event types
   (`src/agent-event-parser.ts`): `agent_start`, `agent_end`,
   `message_start`, `message_update`, `message_end`, `tool_execution_start`,
   `tool_execution_end`, `queue_update` — parsed structurally at the IPC
   boundary into `AppAgentEvent` for the Bridge. A second harness either
   emits this shape or gets its own parser input adapter. The wrapper also
   synthesizes this shape itself for prompt rejections
   (`agent.ts::buildPromptFailureEvents`).

5. **Extension / tool registration.** Capabilities reach the agent as
   extension bundles (`agent/bundles.ts`, static registry + disk-drift test)
   receiving injected `AgentPorts` — never direct host imports
   (lint-enforced). Registration flows through pi's `ExtensionFactory` /
   `registerTool`, with `validateToolParametersSchema` rejecting non-
   top-level-`Type.Object` schemas. A replacement must offer per-tool
   registration with JSON-schema parameters plus the session-start hook the
   bundles use, and honor hard tool allowlists (the no-tools inline-AI and
   ghost-text sessions depend on `allowedToolNames: []`).

6. **A stub provider.** Login-free deterministic E2E depends on faux
   (`provider/faux-provider.ts`): a registered provider whose scripted
   responses (including tool calls) drive full agent turns with zero OAuth
   and zero network (`INTELIGIR_FAUX_AGENT=1`, the `setFauxAgentScript`
   channel, the e2e-drive skill). A replacement harness needs an equivalent
   scriptable stub or the whole headless verification story dies.

Also load-bearing, below the six: session persistence (`SessionManager` —
resume-most-recent, isolated session dirs, in-memory ephemeral sessions;
transcripts under `~/.inteligir/sessions/*` are swept 0600 by `hardenAppDir`)
and workspace discovery (`agentDir`, AGENTS.md, the `./vault` symlink).

## What a swap touches vs. leaves alone

- **Reimplemented:** everything in `server/pi/*`, the faux stub, the
  `tool_call` hook wiring in `agent/privacy/extension.ts` (+ a new
  path-parity module; the gate core `privacy/gate.ts` is pure and stays),
  and possibly an event adapter for seam 4.
- **Untouched:** the renderer (Bridge-only, harness-agnostic), `@repo/core`,
  the Bridge handlers, provider catalog/service/store (neutral selections),
  delegation manager, app-machine — they all drive the `agent/agent.ts`
  `Agent` API, which after #460 carries no pi types.
