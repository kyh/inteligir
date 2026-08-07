# @repo/bridge

The isomorphic wire contract between clients and the host: the Bridge/IPC
registry, the ws client + protocol, the agent grant table, and the shared
domain schemas.

## Why it exists

Loads in a browser, in React Native and on workerd alike — no node/electron/
react imports, ever. That boundary is a package fact: deps are `@repo/notes` +
typebox only. Both ends of the wire read the same registry, so the host's
handler map and the client's `Bridge` type cannot drift.

## Layout

```
src/
  ipc-registry.ts       # THE single source of truth: every channel = TypeBox payload
                        # schema + result/event type; Bridge, IpcHandler, IpcEvent,
                        # IPC_METHODS, HYDRATED_EVENTS all derive from it
  ws-protocol.ts        # frame vocabulary shared by the UserHost DO + client:
                        # auth/req/send → welcome/res/evt; close codes; binary tags
  ws-bridge.ts          # the Bridge over a WebSocket (browser + React Native);
                        # ticket minter, reconnect supervisor, request queue
  backoff.ts            # the ONE capped-exponential retry-delay policy (schedule injected)
  wire-helpers.ts       # isRecord (re-export from notes), toErrorMessage, isHttpUrl
  deep-link.ts          # inteligir:// pure parser + sanitizer — exactly six verbs
  agent-grants.ts       # the agent's capability policy: granted tiers + the
                        # never-granted set, each with a reason written for a model
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
  ui-state.ts, daily-notes.ts
                        # ui-state keys, daily-note/template conventions
```

## Invariants

- **ipc-registry.ts is the single source of truth.** Every channel pairs a
  TypeBox payload schema (runtime validation) with a result/event type
  (compile-time inference); `Bridge` and the ws dispatch derive from it, so a
  rename is a compile error everywhere. Add a channel = registry entry + host
  handler + a real fixture-bridge line — checklist in
  `.claude/skills/add-bridge-channel`. A channel with no CALLER is caught by
  `tools/repo-guards`, and one the grant table has not weighed by
  `src/__tests__/agent-grants.test.ts`.
- **All inbound frame parsing is a type guard**: a malformed frame is `null`,
  never a throw (`ws-protocol.ts` parse functions).
- **deep-link.ts is world-invokable**, so every guard lives in the pure
  parser: six verbs only (`append`/`task`/`today`/`note`/`search`/`session`),
  oversize input REJECTED never truncated, capture target paths computed
  host-side never taken from the URL, `session` carries an opaque single-use
  exchange code + state nonce — never a raw token.
- The ws-bridge reconnect supervisor is the ONLY retry owner; `unauthorized`
  (close 4401) is terminal. `HYDRATED_EVENTS` re-pushes stateful event
  channels on reconnect — full event replay is deliberately not provided.
- Executor schemas: requests we construct are exact
  (`additionalProperties: false`); responses are tolerant of extra fields.

## Seams

- `ws-bridge.ts` takes a `WebSocket` implementation (`webSocketImpl`; browser
  default) — dialed in `apps/web/src/app/workspace-mount.tsx`.
- `backoff.ts` takes a `schedule` fn (`setTimeout` in prod, fake in tests).

## Testing

```bash
pnpm --filter @repo/bridge test
```

Notable suites: `deep-link.test.ts` pins the six-verb grammar + rejection
caps; `ws-protocol.test.ts` pins frame parsing (malformed → null);
`routine-schedule.test.ts` pins the one-comparison due rule;
`chat-log.test.ts` folds the shared fixture stream (`chat-log-fixtures.ts`,
also exported to the workspace's suites); `agent-grants.test.ts` pins that the
grant table weighs every non-event channel exactly once.
