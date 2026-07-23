# @repo/bridge

The isomorphic wire contract between UIs and the backend: the Bridge/IPC
registry, the ws client + protocol, and the shared domain schemas.

## Why it exists

Loads in the desktop renderer (browser), React Native, and node alike — no
node/electron/react imports, ever. That boundary is a package fact: deps are
`@repo/notes` + typebox only. The renderer and mobile depend on @repo/bridge
(+notes/ui) ONLY — never `@repo/server` — so "no node in the UI's contract"
is an unresolvable-import fact, not a lint opinion. Host packages below
server (agent, connectors, vault, sync, voice) import it for the same shapes.

## Layout

```
src/
  ipc-registry.ts       # THE single source of truth: every channel = TypeBox payload
                        # schema + result/event type; Bridge, IpcHandler, IpcEvent,
                        # IPC_METHODS, HYDRATED_EVENTS all derive from it
  ws-protocol.ts        # frame vocabulary shared by ws host + client: auth/pair/req/
                        # send → welcome/paired/res/evt; close codes; binary STT tag
  ws-bridge.ts          # the Bridge over a WebSocket (desktop renderer + mobile);
                        # reconnect supervisor, request queue, injected WebSocket impl
  backoff.ts            # the ONE capped-exponential retry-delay policy (schedule injected)
  wire-helpers.ts       # isRecord (re-export from notes), toErrorMessage, isHttpUrl
  deep-link.ts          # inteligir:// pure parser + sanitizer — exactly six verbs
  dev-flags.ts          # fail-closed gate for dev-only env switches (#465)
  agent-events.ts       # AppAgentEvent — the typed agent event vocabulary
  agent-event-parser.ts # raw pi events → AppAgentEvent at the IPC boundary (pure)
  chat-log.ts           # chat surface as a pure fold over agent events + history
  chat-message.ts, chat-sessions.ts, note-context.ts, agent-instructions.ts
                        # chat wire shapes: read-only session browser, auto-attached
                        # open-note turn prefix, shared instruction text
  app-state.ts          # app LIFECYCLE machine types (login is not an app phase)
  ai-provider.ts, inline-ai.ts  # provider settings + editor-AI/ghost-text params
  delegation.ts, routines.ts, routine-schedule.ts
                        # delegation wire shapes; routine model + pure due-math
  executor.ts           # wire types for the connectors daemon HTTP API (executor 1.5.4)
  sync.ts, remote-access.ts, ui-state.ts, daily-notes.ts
                        # vault-sync + device-pairing contracts, ui-state keys,
                        # daily-note/template conventions
```

## Invariants

- **ipc-registry.ts is the single source of truth.** Every channel pairs a
  TypeBox payload schema (runtime validation) with a result/event type
  (compile-time inference); `Bridge` and the ws dispatch derive from it, so a
  rename is a compile error everywhere. Add a channel = registry entry + host
  handler + a real fixture-bridge line — checklist in `docs/development.md`
  ("Adding a Bridge channel").
- **All inbound frame parsing is a type guard**: a malformed frame is `null`,
  never a throw (`ws-protocol.ts` parse functions).
- **deep-link.ts is world-invokable**, so every guard lives in the pure
  parser: six verbs only (`append`/`task`/`today`/`note`/`search`/`session`),
  oversize input REJECTED never truncated, capture target paths computed
  host-side never taken from the URL, `session` carries an opaque single-use
  exchange code + state nonce — never a raw token.
- **dev-flags is fail-closed**: until `createHost` sets the bit from
  `!platform.isPackaged`, the dev-only env switches (faux agent, emulated
  connectors) are refused. It lives here because both consumers sit below
  @repo/server and already depend on bridge (#465).
- The ws-bridge reconnect supervisor is the ONLY retry owner; `unauthorized`
  (close 4401) is terminal. `HYDRATED_EVENTS` re-pushes stateful event
  channels on reconnect — full event replay is deliberately not provided.
- Executor schemas: requests we construct are exact
  (`additionalProperties: false`); responses are tolerant of extra fields.

## Seams

- `ws-bridge.ts` takes a `WebSocket` implementation (`webSocketImpl`; browser
  default) — dialed in `apps/desktop/src/renderer/main.tsx` and
  `apps/mobile/src/lib/host/connection.ts`.
- `backoff.ts` takes a `schedule` fn (`setTimeout` in prod, fake in tests).
- `dev-flags.ts` is SET only by node-side hosts — `createHost`
  (`packages/server/src/boot/`) computes it once at boot.

## Testing

```bash
pnpm --filter @repo/bridge test
```

Notable suites: `deep-link.test.ts` pins the six-verb grammar + rejection
caps; `ws-protocol.test.ts` pins frame parsing (malformed → null);
`routine-schedule.test.ts` pins the one-comparison due rule;
`chat-log.test.ts` folds the shared fixture stream (`chat-log-fixtures.ts`,
also exported to desktop/mobile suites); `dev-flags.test.ts` pins fail-closed.
