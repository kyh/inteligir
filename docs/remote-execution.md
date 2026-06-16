# Remote Execution — Migration Plan

**Status:** living document · **Owner:** TBD · **Tracking branch:** `claude/remote-execution-design`

This doc describes how Inteligir moves from a purely **local, on-device agent**
to one that can run **either locally (the Electron desktop) or headless in the
cloud**, with parity on the capability layer. It captures the target
architecture, the seams in today's code, and a sequenced migration so each step
ships independently behind green quality gates.

> **TL;DR of the thesis:** the agent already talks to its powerful capabilities
> through two indirections — the **executor HTTP API** and the **dispatch event
> protocol**. Make those two interfaces _location-transparent_ (executor
> reachable at a URL with real auth; the agent host runnable headless) and
> "local vs cloud" becomes a deployment choice rather than a code fork.

---

## 1. Goals & non-goals

### Goals

- Run a session's agent in the cloud so it keeps working with the laptop closed.
- **Capability parity:** a cloud agent has the same model, tools, connected
  APIs, secrets, skills, and memory as the local agent.
- Keep the desktop **offline-first** — local stays the primary, fully-functional
  surface; cloud is additive.
- One agent core, two deployments — no forked agent logic.

### Non-goals (for now)

- Literal parity for machine-bound capabilities (controlling _your_ Mac, _your_
  local browser, files outside the workspace). See [§6 Parity limits](#6-parity-limits).
- Multi-user collaboration on one session.
- Replacing the desktop with a web app. The desktop remains the product.

---

## 2. Two meanings of "remote"

These need different work; don't conflate them.

|                      | **Remote surface**                                        | **Remote execution (this plan)** |
| -------------------- | --------------------------------------------------------- | -------------------------------- |
| Where the agent runs | Your desktop                                              | A cloud container                |
| What's remote        | The UI driving it (phone/web)                             | The agent process itself         |
| Status               | **Already exists** (mobile pairs over the dispatch relay) | To build                         |

The mobile app is already a _thin client_: the desktop does 100% of execution
and streams events; mobile renders them. That proves the **host ↔ surface**
boundary is already a wire protocol (`@repo/dispatch`), not a function call —
which is exactly the seam a cloud host plugs into.

---

## 3. Current architecture (as-is)

### Execution model

The agent runs in the **Electron main process** via `@repo/pi-driver` wrapping
`@mariozechner/pi-coding-agent`. All state lives under `~/.inteligir/`:

| Path                                           | Purpose                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.inteligir/`                                | pi `agentDir` — skills, `AGENTS.md`, agent state                                                                                                              |
| `~/.inteligir/sessions/`                       | persisted session transcripts (user thread)                                                                                                                   |
| `~/.inteligir/sessions/background/`            | background task agent's sessions — kept out of the user thread's `continueRecent` pool                                                                        |
| `~/.inteligir/workspace/`                      | agent cwd (shell/file tools run here)                                                                                                                         |
| `~/.inteligir/bin/`                            | installed CLIs, prepended to `PATH`                                                                                                                           |
| `~/.inteligir/auth.json`                       | OpenAI OAuth credentials (pi `AuthStorage`)                                                                                                                   |
| `~/.inteligir/executor/`                       | executor daemon binary, data, scope (secrets/OAuth)                                                                                                           |
| `~/.inteligir/runtime-ui.json`                 | widget defs + state (`ShellManager`)                                                                                                                          |
| `~/.inteligir/*.json`, `logs/`, `screenshots/` | app state stores — `dispatch-room.json`, `tasks.json`, `task-runs.json`, `daily-refresh.json`, `notifications.json`, `ui-state.json`, agent logs, screenshots |

The sync strategy (Slice 6) must decide per-path: portable agent context
(skills, sessions, workspace) syncs; desktop app state (widgets, notifications,
dispatch room) stays local.

### The two indirections that make remote tractable

1. **The executor is already a standalone daemon.**
   `apps/desktop/src/main/executor/executor-daemon.ts` spawns a separate binary
   bound to `127.0.0.1` on a random port, auth'd with a bearer-token UUID. The
   agent's `execute` tool just does `fetch POST 127.0.0.1:{port}/api/executions`
   (catalog/secrets/connection endpoints are scope-prefixed, `/api/scopes/{id}/…`;
   see `executor-client.ts`). It owns the API catalog (MCP/OpenAPI/GraphQL/
   Google), the secrets/OAuth scope, the code sandbox, and policies. **The
   client only cares about a base URL + token** — already relocatable.

2. **The dispatch protocol decouples surface from host.**
   `@repo/dispatch` defines a typed envelope (`to_device` / `to_mobile`).
   `apps/desktop/src/main/app-machine.ts` emits normalized events through
   `sendDispatchResponse()`; `apps/server` (Cloudflare Worker, partyserver)
   relays them to the room; mobile renders. The same worker also bridges **chat
   platforms** (Slack/Telegram/WhatsApp/Discord webhooks → correlated
   request/response against the registered desktop) — a third surface that
   already treats the agent host as "whatever answers on the room". The agent
   host ↔ surface boundary is a wire protocol.

### What's local-only today

- The agent process (Electron main).
- Session state, skills, memory (local fs, no sync).
- Tool execution: shell/file tools against the local workspace; executor on localhost.
- Machine-bound extensions: `peekaboo` (macOS automation), `browser` (local
  browser), `ui` (desktop shell widgets).

### Known gap: relay auth is partial

`apps/server/src/server.ts` has grown beyond a dumb relay: it now also bridges
**chat platforms** (Slack/Telegram/WhatsApp/Discord webhooks) to the desktop
agent via a correlated request/response path, and that path is fail-closed
behind `CHAT_RELAY_SECRET` — device registration and gateway POSTs both require
the secret. But the **WebSocket room relay itself is still room-code-only**:
any peer that knows the 6-char code joins the room and receives relayed
traffic. Fine for LAN-style pairing, **not** acceptable as the channel for a
cloud agent holding model creds + secrets + arbitrary code execution. Slice 0
extends the existing secret mechanism to per-user identity + signed tokens for
_all_ room participants (see [§7](#7-security-model)).

---

## 4. Target architecture

A session runs in an **environment**, which is either `local` (desktop, today)
or `cloud` (an ephemeral container). Both run the **same headless agent host**
and both speak the **same dispatch protocol** to whatever surface is watching.

```
            ┌──────────────── surfaces ───────────────┐
            │  desktop renderer   mobile   chat (web   │  (thin clients; render
            │                              gateway)    │   events, send input)
            └───────────▲────────────▲─────────▲───────┘
                        │ dispatch   │
                ┌───────┴────────────┴───────┐
                │   dispatch relay (authed)   │   apps/server — now per-user
                └───────▲────────────▲────────┘    identity + signed tokens
                        │            │
          ┌─────────────┴──┐    ┌────┴───────────────┐
          │ LOCAL host     │    │ CLOUD host         │   same @repo/agent-host
          │ (Electron main)│    │ (container, Node)  │   core; different bundles
          └───────▲────────┘    └────────▲───────────┘
                  │                       │
            executor (localhost)    executor (hosted, URL+token)
                  └───────────┬───────────┘
                       same catalog + secrets
```

- **`@repo/agent-host`** — the Electron-free core (lifecycle, session
  resolution, relocatable paths). Consumers inject auth/model and an opaque
  extension-factory thunk; the bundle framework itself stays consumer-side.
  _(Shipped — slice 1.)_
- **Cloud runner** — a Node service that provisions a container, materializes
  context, and runs `new AgentHost(config).start()` with headless bundles.
- **Hosted executor** — the same executor daemon run as a service; both hosts
  point at it, so tools/secrets are identical regardless of where the agent runs.

---

## 5. Migration slices

Each slice is independently shippable behind `pnpm typecheck && pnpm lint &&
pnpm build`. Ordering reflects dependencies and risk.

### Slice 0 — Auth on the dispatch relay _(prerequisite for anything holding secrets)_

- Add per-user identity + signed, scoped tokens to `apps/server`. Replace the
  bare room-code trust model: a token authorizes a connection to a specific
  room/role and expires.
- A start exists: the chat gateway path is already fail-closed behind
  `CHAT_RELAY_SECRET` (device registration + gateway POSTs). Slice 0 generalizes
  that from one shared secret to per-user tokens covering all WS participants.
- Keep the existing pairing UX on top (room code → exchanged for a token).
- **Delivers:** the relay can safely carry a cloud agent's traffic.
- **Risk:** medium. Touches every dispatch client (`dispatch-client.ts`, mobile
  `dispatch.tsx`). No agent changes.

### Slice 1 — Headless agent host ✅ _(done — PR #338)_

- New `@repo/agent-host` package, Electron-free:
  - `paths.ts` — relocatable layout (`INTELIGIR_HOME` override). Provider/model
    selection is deliberately consumer config, injected via `AgentHostConfig`.
  - `agent.ts` — `AgentHost`, the parameterized lifecycle over `PiAgent`
    (session resolution + the agent surface). Everything environment-specific
    (paths, auth, model, **extension factories**) is injected. `AgentHost` takes
    `extensionFactories` as an opaque thunk — the same shape `PiAgent` accepts —
    so it stays decoupled from _how_ a consumer builds/validates its bundles.
- Desktop consumes it: `agent/paths.ts` binds the host layout; `Agent`
  subclasses `AgentHost`, passing its factories + `initialActiveToolNames`.
- **The extension framework stays desktop-side, by design.** `main` landed a
  parallel "ports" refactor (`main/lib/agent-lifecycle.ts` builds shell/tasks/
  executor capability ports that bundles act through, keeping `agent/` off
  `@/main`). Those ports reference desktop-specific shared types, so the bundle
  framework (`agent/extension.ts`) is desktop-coupled. The opaque-factory seam
  above means the host doesn't need it — a cloud runner builds its own factories
  (with its own ports) and hands the thunk to `AgentHost`.
- **Delivers:** the agent core can be constructed and run with injected
  factories/auth/config — the keystone. No behavior change for desktop.

### Slice 2 — Extract the turn-tracker / event sink

- Today `app-machine.ts` owns turn tracking + empty-turn detection + fan-out to
  renderer/dispatch/notifications. Extract the **pure** part into
  `@repo/agent-host` (`events.ts`): a tracker that consumes raw pi events,
  normalizes them (move `agent-event-parser.ts` + `agent-events.ts` types into
  the package), runs empty-turn detection, and emits to an injected **sink**.
- Desktop's sink = broadcast to renderer + `sendDispatchResponse` + notify +
  `machine.ingest`. Cloud's sink = dispatch only.
- The **background task agent** (`main/tasks/background-agent.ts`) is the proof
  case already in-tree: a second `Agent` that deliberately does _not_ fan out to
  renderer/notifications. Today it gets that by simply not subscribing; with the
  extracted tracker it becomes "same tracker, log-only sink".
- **Delivers:** the headless event-handling primitive the cloud host needs.
- **Risk:** medium — behavior-sensitive (empty-turn UX). Preserve exactly;
  cover with tests.

### Slice 3 — Hosted executor service

- Run the executor daemon as a network-reachable service (per-user pod or hard
  scope isolation), with the bearer-token UUID replaced by a real auth token.
- `executor-client` gains a base-URL/token config; localhost stays the default
  for local, a hosted URL for cloud.
- Move the secrets/OAuth scope (`~/.inteligir/executor/scope`) server-side.
- **Delivers:** identical tools/connected-APIs/secrets across local **and**
  cloud — even before cloud agents exist, this unifies integrations.
- **Risk:** high — custody of user credentials shifts off-device; multi-tenancy
  - isolation are real work. Depends on Slice 0.
- ⚠️ **Filesystem caveat:** executor code that orchestrates _APIs_ relocates
  cleanly; executor code that touches the _local workspace_ does not. Pair with
  the cloud workspace (Slice 5).

### Slice 4 — Headless seeding + a cloud bundle set

- Extract the reusable core of `seedResources` (mkdirs, `PATH`, seed
  skills/`AGENTS.md`, `runBundleSetups`) into `@repo/agent-host` (the
  Electron-specific bits — packaged-resource resolution, executor eager-start,
  singleton resets — stay desktop-side).
- Define a **headless bundle set** for cloud: `executor` (pointed at the hosted
  URL) + portable tools; machine-bound bundles (`peekaboo`, local `browser`,
  `ui`) are omitted or degraded. See [§6](#6-parity-limits).
- **Delivers:** a host that can stand up its own state and tools in a container.

### Slice 5 — Cloud runner + provisioning

- A Node service that, on "run in cloud": spins an ephemeral container, sets
  `INTELIGIR_HOME` to a per-session scratch dir, **materializes context**
  (skills, memory, `AGENTS.md`, the relevant repo/workspace), hands it the
  hosted executor URL + token + a scoped model credential, runs the headless
  host, connects it to the authed relay as the room's "device", and reclaims the
  container after.
- **Delivers:** end-to-end remote execution driven from the existing surfaces.
- **Risk:** high — new infra surface (container lifecycle, provisioning, model
  credential brokering).

### Slice 6 — Skills / memory / session sync

- **Recommendation: local-first hybrid.** Local stays source of truth (offline
  works). Treat the cloud env as a _working copy_:
  - On session start: snapshot-and-push the relevant subset of
    `~/.inteligir/{skills, AGENTS.md, memory}` + workspace into the env.
  - During/after: stream mutations (new memory, edited skills, transcript) back.
  - A content-addressed or git-style sync is enough on day one — no DB required.
- Graduate to a **hosted source of truth** later (one store both hosts read)
  once Slices 0/3 exist and offline semantics are settled.
- **Delivers:** the cloud agent's skills/memory match the local agent's.

### Slice 7 — Extension capability tiers

- Mark each extension `portable` vs `machine-bound`. Cloud hosts load only
  portable ones; machine-bound ones either degrade gracefully or **route back**
  to a connected local host (e.g. a cloud agent asks the paired desktop to drive
  the local browser).
- **Delivers:** honest, predictable behavior about what a cloud agent can/can't do.

---

## 6. Parity limits

"The remote needs the exact same things as local" is achievable for the
**capability layer** precisely because those go through indirection. It is
**not** fully achievable for capabilities that reach for the physical machine.

| Capability                                | Portable to cloud? | Notes                                              |
| ----------------------------------------- | ------------------ | -------------------------------------------------- |
| Model (LLM)                               | ✅                 | Already remote                                     |
| Executor tools / connected APIs / secrets | ✅                 | Via hosted executor (Slice 3)                      |
| Skills / memory / `AGENTS.md`             | ✅                 | Via sync (Slice 6)                                 |
| Session transcripts                       | ✅                 | Via sync (Slice 6)                                 |
| Repo / workspace files                    | ✅                 | Clone/materialize into the container               |
| Shell / file tools                        | ✅                 | Against the _container_ workspace, not your laptop |
| `peekaboo` (macOS automation)             | ❌                 | Controls _your_ Mac — degrade or route back        |
| Local `browser` automation                | ❌                 | Tied to your local browser — route back            |
| `ui` widgets / desktop shell              | ❌                 | A surface, not a host capability                   |
| Files outside the workspace               | ❌                 | Don't exist in the container                       |

The realistic framing: cloud agents get **full parity on the portable set**;
machine-bound extensions degrade or route to a connected local host.

---

## 7. Security model

Moving execution and secrets off-device is the riskiest part. Principles:

1. **Auth before secrets (Slice 0 gates Slice 3+).** No secrets, model creds, or
   code-exec traffic over the relay until it has per-user identity + signed,
   scoped, expiring tokens. The current room-code model is pairing-grade only.
2. **Custody shift is explicit.** Today OAuth/secrets live on-device and never
   leave. Hosting the executor makes _us_ the custodian of user credentials —
   a deliberate trust change that needs isolation, encryption at rest, and a
   clear data-handling story.
3. **Least privilege per session.** A cloud env gets a _scoped_ model credential
   and a _scoped_ executor token, not the user's full keychain. Reclaim on
   session end.
4. **Isolation.** Hosted executor is per-user pods or hard sandbox scope
   separation — one user's code/secrets can never reach another's.
5. **External input is untrusted.** PR/issue/comment/CI content (and anything in
   `<untrusted_external_data>`) is data, not instructions.

---

## 8. Sync strategy (skills / memory / sessions)

Two options considered:

- **Sync/replication (recommended first):** local is source of truth; push the
  relevant subset into the cloud env at start, push mutations back. Offline-
  friendly, smaller change.
- **Hosted source of truth (later):** one store both hosts read from — no
  "sync", but bigger change and loses offline-first.

**Decision:** start local-first hybrid (Slice 6), graduate to hosted source of
truth once auth + session store exist and offline semantics are settled.

---

## 9. Sequencing summary

```
Slice 0  Auth on relay ───────────────┐ (gates 3,5)
Slice 1  Headless agent host ✅────────┤ (gates 2,4)
Slice 2  Turn-tracker / event sink ────┤ (needed by 5)
Slice 3  Hosted executor ──────────────┤ (needs 0)
Slice 4  Headless seeding + cloud bundles
Slice 5  Cloud runner + provisioning ──┤ (needs 1,2,3,4)
Slice 6  Skills / memory / session sync
Slice 7  Extension capability tiers
```

The cleanest path to a first end-to-end demo: **0 → 1 → 2 → 3 → 4 → 5**, with
6 and 7 hardening parity afterward. Slices 1, 3, and 6 each deliver standalone
value even before cloud agents exist (1 = reusable core, 3 = unified tools/
secrets, 6 = portable context).

---

## 10. Open questions

- **Container substrate** for the cloud runner — Cloudflare (containers/DO),
  Fly, or a dedicated orchestrator? Affects cold-start, networking to the hosted
  executor, and reclaim semantics.
- **Model credential brokering** — does the cloud agent use the user's OpenAI
  OAuth (replicated, sensitive) or a per-user server-minted token?
- **Executor multi-tenancy** — per-user pod vs shared daemon with hard scope
  isolation; cost vs blast-radius tradeoff.
- **Workspace semantics for cloud** — fresh repo clone (CCW-style) vs synced
  copy of the local workspace; how do uncommitted local changes reach the cloud?
- **Hand-off UX** — how does a user move a live session local↔cloud, and what
  happens to in-flight turns?
