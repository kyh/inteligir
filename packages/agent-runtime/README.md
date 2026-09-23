# @repo/agent-runtime

The ACP agent runtime: one adapter speaks Zed's agent-client-protocol to a
`claude-code-acp` or `codex-acp` child, harnesses are data rows, and what comes
back is translated into the runtime's own provider-event grammar. A consumer
says "start a session, run a turn, give me events" and never touches a process
or a wire format.

## Why it exists

The product drives a coding agent it does not own. Two harnesses exist today
and both speak ACP, so the seam between "the server's thread service" and "a
vendor's CLI" is one adapter over one protocol, and adding a harness is a row
in a table rather than a second runtime. What the server needs from that seam
is small — an `AgentRuntime` with `startThread`, `resumeThread`, `runTurn`,
`reapIdleProviderSessions`, `hasThread`, `closeThread`, `shutdown`
(`types.ts`) — and the interface carries only what the host calls, because a
method kept for a re-vendor is a stub every test double must write.

The package is node-side by definition (it spawns processes), so nothing it
exports may pull a process tree into a renderer: the grammars a client reads
live in `@repo/domain`, and this package reaches `@repo/domain` alone
(`tools/repo-guards/src/dep-dag.test.ts`, its `DECLARED_EDGES` row and its
platform rule). Its one consumer is the `inteligir` server —
`apps/cli/src/server/agents/runtime-manager.ts` composes it.

## Layout

```
src/
  types.ts             # the AgentRuntime interface and its option/arg shapes —
                       # only what the host calls
  acp/
    acp-runtime.ts     # createAcpAgentRuntime: one adapter child per thread,
                       # the ACP client handlers, session open/load/close/reap
    harness-registry.ts  # HARNESSES — claude and codex as rows: vendor binary,
                       # login command, adapter entry, credential probes,
                       # model application, env keys to omit
    acp-event-mapping.ts  # AcpTurnMapper: one session's notifications → the
                       # provider-event grammar, with the turn's item ids
    acp-permission-mapping.ts  # requestPermission ↔ @repo/domain's approval
                       # payload and resolution
    provider-error.ts  # acpCall (a rejected request → RequestError) and
                       # describeProviderError (an auth refusal → the login
                       # command)
  vocabulary/
    provider-event.ts  # ProviderEvent — the runtime's EMITTED grammar
    json-value.ts      # JsonValue/JsonObject, for tool arguments
  thread-shell-environment.ts  # stamps INTELIGIR_THREAD_ID onto a spawn's env
  test-support/
    fake-acp-agent.mjs # a scripted ACP agent (FAKE_ACP_MODE) the server's
                       # runtime-manager suite spawns in place of a vendor
```

## Invariants

- **ACP has no turn ids and no steering, so the runtime mints the turn.** A
  prompt's response is the turn's end and a prompt owns its session until it
  settles; `runTurn` mints an id, opens an `AcpTurnMapper` bound to it, emits
  `turn/started`, and resolves once the prompt is on the wire rather than when
  it settles, because the send must return while the turn streams. A mid-turn
  message waits in the host's queue. The host binds this provider turn id to its
  own on the first `turn/started` and drops any turn-scoped event naming another
  (a resume replay) — `CONTEXT.md` "host turn id vs provider turn id".
- **`ProviderEvent` is constructed here and never parsed.** It is wider than
  `ThreadEvent` in `@repo/domain` and types only; the server narrows it onto
  the persisted grammar in `apps/cli/src/server/agents/event-mapping.ts`, and a
  kind with no persisted counterpart is dropped with a reason, never re-shaped.
  Never invent a divergent shape for an event bb already names; re-vendor it.
  `CONTEXT.md` "event means four things" holds the four layers apart.
- **A harness is a data row.** `HARNESSES` names the vendor binary, the login
  command, the adapter entry resolved through `require.resolve`, the credential
  probes the status probe checks, how a model is applied (an env var for
  Claude, a `-c model=` arg for Codex) and the env keys to omit — the claude SDK
  refuses to run when it believes it is nested inside another claude session,
  so the nesting sentinel must not leak through from whatever launched this
  app. `requireHarness` is the one gate from a `providerId` to a row.
- **`shellEnv` is a getter read at every spawn.** The host's session facts
  (`INTELIGIR_DATA_DIR`, `INTELIGIR_SKILLS_DIR`, the PATH carrying the
  `inteligir` bin) are one object projected into env and prompt, and reading it
  once froze it at the first turn — so the option is a function, called per
  spawn, and `INTELIGIR_THREAD_ID` is stamped on top per thread.
- **`mcpServers` is a lazy, async getter for the same reason**: an enabled
  connector row edited in Settings reaches the next `session/new` or
  `session/load` without a reboot, and an OAuth row can refresh its token on
  the way. The connectors registry is the app's; this package only carries the
  rows into ACP's `McpServer` shape.
- **File-shaped tool kinds become `fileChange` items.** An `edit`/`delete`/
  `move` call lands as one `fileChange` with a change per diff or location, and
  the server's commit hold stages a turn's write set from exactly these. An
  `execute` call is a `commandExecution`; everything else is a `toolCall`.
- **A permission answer is one of the agent's own option ids.** The exact kind
  first, then the same allow/reject family; no offered option answers
  `cancelled`. An unrecognised tool kind falls back to the command subject,
  because the contract has no "other".
- **A rejected request is parsed where it is made.** The 0.4 client rejects
  with the response's bare JSON-RPC `error` object, not an Error, so every
  `initialize`, `session/new`, `session/load` and `session/prompt` goes through
  `acpCall`, which rebuilds it as the SDK's `RequestError`. What a user reads
  is `describeProviderError`: the adapter's message, except an auth refusal
  (`-32000`) with a harness in hand, which names the harness and its login
  command.
- **A session is registered only once the agent names it.** A refused or
  failed `initialize`, `session/new` or `session/load` registers nothing and
  takes its child with it, so the send after a sign-in opens a new adapter
  rather than prompting a session that never existed, and every registered
  session can be prompted. A thread has one child at a time: opening one first
  ends whatever the thread still holds, so two adapters never write one
  provider session's files.
- **A request never outlives its child.** The 0.4 client never rejects a
  pending request when its stream ends, so every request races the child's
  exit, which rejects naming the harness, the exit status and the child's last
  stderr lines. A crash at boot fails the dispatch; a crash mid-turn fails the
  turn through the mapper, like a refused prompt. There is no exit callback: a
  second answer to "did this turn fail?" would be one to keep in step.
- **A child the runtime ends itself emits nothing more.** `closeThread` (the
  host abandoning a turn), a reap and `shutdown` unregister the session first,
  and the turn it was running is the host's to settle. `closeThread` sends
  `session/cancel` so the agent can stop its own tools, then SIGTERM once the
  prompt settles or `SESSION_SHUTDOWN_GRACE_MS` passes, then SIGKILL after the
  same grace.
- **Nothing here remembers.** Claude Code and Codex carry their own memory; the
  repo's decision record retired a third beside them.

## Seams

- `AgentRuntimeOptions` (`types.ts`) — `onEvent` (every `ProviderEvent`),
  `onInteractiveRequest` (a permission request as a `PendingInteractionCreate`,
  answered with a `PendingInteractionResolution`), `onStderr`, and the two
  getters above.
- `AcpAgentRuntimeOptions.spawnAdapter` (`acp/acp-runtime.ts`) — the one
  injection point for a fake child: the server's suites spawn
  `test-support/fake-acp-agent.mjs` through it.
- `HARNESSES` — read by the server's status probe for "is the CLI on PATH, is a
  credential present, what is the login command"; the prompt and env are the
  host's own projections of its session facts.

## Testing

```bash
pnpm --filter @repo/agent-runtime test
```

`src/acp/__tests__/acp-mapping.test.ts` pins the pure halves: session
notifications onto the provider-event grammar (one message item per turn,
edit-kind calls as `fileChange`, cancellation interrupting open items, a prompt
rejection failing through the grammar) and permission requests onto the
pending-interaction contract; `provider-error.test.ts` pins the rejection
rebuild and the auth hint. The process half — spawning, `initialize`,
`session/new`, `session/load`, a close after the watchdog, an adapter crashing
at boot or mid-prompt, an adapter refusing for auth as a session opens or at
the prompt — is exercised by the server's
`apps/cli/src/server/agents/__tests__/acp-manager.test.ts` against the fake
agent, because the assertions there are about what the host does with the
events.
