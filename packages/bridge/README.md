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

The IPC seam is four files, split so a reader can tell the list from the
machinery — the table is flat and long, the derivations are short and deep, and
the judgement calls are neither:

```
src/
  ipc-entry.ts          # the four channel kinds (invoke / invokeVoid / send / event)
                        # and the phantom types that carry their wire shapes
  ipc-registry.ts       # THE TABLE: every channel, one row, grouped by domain.
                        # Names channels and nothing else — schemas and result
                        # types live with their domain module
  ipc-contract.ts       # THE MACHINERY, all derived from the table and naming no
                        # channel: Bridge, HostMethod, EventMethod, IpcHandler,
                        # IpcEvent
  channel-policy.ts     # the three per-channel opt-ins the compiler cannot ask
                        # for: REMOTE_ALLOWED_*, HYDRATED_EVENTS, BINARY_CHANNELS
  vault.ts, knowledge.ts, skills.ts, notifications.ts
                        # the payload schemas + result types those channels carry
  agent-actions.ts, agent-script.ts
                        # agent write checkpoints + destructive confirmations;
                        # the scripted container's queued turns
  ws-protocol.ts        # frame vocabulary shared by the UserHost DO + client:
                        # auth/req/send → welcome/res/evt; close codes; binary tags
  ws-bridge.ts          # the Bridge over a WebSocket (browser + React Native);
                        # ticket minter, reconnect supervisor, request queue
  client.ts             # installBridge / getBridge — the module-level Bridge
                        # slot a host fills before first render; getBridge()
                        # throws until it does
  backoff.ts            # the ONE capped-exponential retry-delay policy (schedule injected)
  wire-helpers.ts       # isRecord (THE definition — every wire boundary parses
                        # through it), toErrorMessage, isHttpUrl, extractText
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
                        # ui-state keys; the three periodic cadences (daily,
                        # weekly, monthly) with their folders/formats/templates,
                        # plus the template substitution rules
  voice.ts              # the voice constants both ends share
```

## Invariants

- **ipc-registry.ts is the single source of truth.** Every channel pairs a
  TypeBox payload schema (runtime validation) with a result/event type
  (compile-time inference); `Bridge` and the ws dispatch derive from it, so a
  rename is a compile error everywhere. Add a channel = registry entry + host
  handler + a real fixture-bridge line + a grant-table row — all four are
  COMPILE errors until answered, which is why the skill
  (`.claude/skills/add-bridge-channel`) is short. The one thing left to a test
  is the one no type can see: a channel with no CALLER anywhere in the repo
  (`tools/repo-guards`).
- **The registry holds no domain types.** A payload schema or a result type
  lives in the module that owns the concept (`vault.ts`, `knowledge.ts`,
  `delegation.ts`, …) and the table imports it. That keeps the table readable
  one row at a time, and keeps a type's consumers off the registry's import
  graph.
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
- Payload schemas are exact (`additionalProperties: false`), so a field the host
  does not know about is a refusal rather than a silent drop — union members
  included, since a loose member admits excess fields exactly as a loose
  top-level object would. Pinned by `src/__tests__/payload-schemas.test.ts`,
  which found `readChatSession` the first time it ran.

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
grant table weighs every non-event channel exactly once;
`payload-schemas.test.ts` pins schema exactness.
