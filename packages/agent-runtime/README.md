# @repo/agent-runtime

The ACP agent runtime: one adapter speaks the Agent Client Protocol
(`@agentclientprotocol/sdk`) to a `claude-agent-acp` or `codex-acp` child,
harnesses are data rows, and what comes back is translated into the runtime's
own provider-event grammar. A consumer
says "start a session, run a turn, give me events" and never touches a process
or a wire format.

## Why it exists

The product drives a coding agent it does not own. Two harnesses exist today
and both speak ACP, so the seam between "the server's thread service" and "a
vendor's CLI" is one adapter over one protocol, and adding a harness is a row
in a table rather than a second runtime. What the server needs from that seam
is small — an `AgentRuntime` with `startThread`, `resumeThread`, `runTurn`,
`reapIdleProviderSessions`, `hasThread`, `cancelTurn`, `closeThread`, `shutdown`
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
    provider-error.ts  # describeProviderError: a refusal's message, or for
                       # an auth refusal the login command
  vocabulary/
    provider-event.ts  # ProviderEvent — the runtime's EMITTED grammar
  thread-shell-environment.ts  # stamps INTELIGIR_THREAD_ID onto a spawn's env
  test-support/
    fake-acp-agent.mjs # a scripted ACP agent (FAKE_ACP_MODE) the server's
                       # runtime-manager suite spawns in place of a vendor
scripts/
  record-acp-transcripts.ts  # live turns through the runtime against the
                       # pinned adapters, scrubbed into the replay fixtures
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
- **`ProviderEvent` is exactly what `AcpTurnMapper` constructs, and is never
  parsed.** Types only, and no wider than the mapper: a kind or field no code
  here produces is a branch every consumer would carry for nothing. The server
  narrows it onto `ThreadEvent` in `@repo/domain` in
  `apps/cli/src/server/agents/event-mapping.ts`, and a kind with no persisted
  counterpart (a plan update, a tool's progress, a notice) is dropped with a
  reason, never re-shaped. `CONTEXT.md` "event means four things" holds the four
  layers apart.
- **A harness is a data row.** `HARNESSES` names the vendor binary, the login
  command, the adapter entry resolved through `require.resolve`, the credential
  probes the status probe checks, how a model is applied (an env var for
  either: `ANTHROPIC_MODEL`, or a `CODEX_CONFIG` the codex adapter merges into
  every session) and the env keys to omit — the claude SDK
  refuses to run when it believes it is nested inside another claude session,
  so the nesting sentinel must not leak through from whatever launched this
  app. `HARNESS_IDS` is the id set in preference order, and `harnessIdSchema`
  and `isHarnessId` are the only ways in: an own-key check, since `in` admits
  every `Object.prototype` name. `requireHarness` is the one gate from a
  `providerId` to a row. A model is per harness (`models`, a `HarnessModels`),
  because a model id is vendor-specific: one string for every adapter would
  hand codex a claude model.
- **A resume says whether the agent kept its history.** `resumeThread`
  answers `loaded`: true only when `session/load` succeeded, false when the
  agent could not load it and a fresh `session/new` stands in, so the host
  hands a loaded session only the instructions that changed and a fresh one
  all of them.
- **`shellEnv` is a getter read at every spawn.** The host's session facts
  (`INTELIGIR_DATA_DIR`, `INTELIGIR_SKILLS_DIR`, the PATH carrying the
  `inteligir` bin) are one object projected into env and prompt, and reading it
  once froze it at the first turn — so the option is a function, called per
  spawn, and `INTELIGIR_THREAD_ID` is stamped on top per thread, its name
  spelled once in `@repo/domain/agent-shell-env` because the CLI reads it back
  in the same shell.
- **`mcpServers` is a lazy, async getter for the same reason**: an enabled
  connector row edited in Settings reaches the next `session/new` or
  `session/load` without a reboot, and an OAuth row can refresh its token on
  the way. The connectors registry is the app's; this package only carries the
  rows into ACP's `McpServer` shape.
- **File-shaped tool kinds become `fileChange` items.** An `edit`/`delete`/
  `move` call lands as one `fileChange` with a change per diff or location, and
  the server's commit hold stages a turn's write set from exactly these. An
  `execute` call is a `commandExecution`, and so is a call codex names
  `exec_command` whatever its kind, since codex kinds a shell command by what it
  does (an `ls` is a `read`); everything else is a `toolCall`. A
  `tool_call_update`'s content REPLACES the call's content, as the protocol
  says: claude sends a shell call's description, then its output. A call's
  output is its content's text, else `rawOutput.formatted_output`, the only
  place codex puts a shell command's output.
- **What the adapter says for itself is a `provider/notice`, never the
  message.** An ACP `notice` update lands as one, and so does the chunk codex
  falls back to for its own warnings when the client advertises no notices:
  `Warning: …` with no `messageId`, which every chunk the model writes carries.
  A warning the model wrote itself stays in its message. The server has no row
  for a notice yet, so it drops it with the notice's text as the reason, into
  the agent log.
- **A permission answer is one of the agent's own option ids.** The exact kind
  first, then the same allow/reject family; no offered option answers
  `cancelled`. An unrecognised tool kind falls back to the command subject,
  because the contract has no "other".
- **What a user reads of a refusal is `describeProviderError`.** The SDK
  rejects a refused request with a `RequestError` (an Error carrying the
  JSON-RPC `code`); the adapter's message is shown, except an auth refusal
  (`-32000`) with a harness in hand, which names the harness and its login
  command.
- **A session is registered only once the agent names it.** A refused or
  failed `initialize`, `session/new` or `session/load` registers nothing and
  takes its child with it, so the send after a sign-in opens a new adapter
  rather than prompting a session that never existed, and every registered
  session can be prompted. A thread has one child at a time: opening one first
  ends whatever the thread still holds, so two adapters never write one
  provider session's files.
- **A request never outlives its child.** The child's exit closes the
  connection with an error naming the harness, the exit status and the child's
  last stderr lines, and the SDK rejects every pending request with it. stdout
  ending does not close the connection first (it is piped with
  `preventClose`), because that close would reject with a bare "connection
  closed" before the exit could say why. A crash at boot fails the dispatch; a
  crash mid-turn fails the turn through the mapper, like a refused prompt.
  There is no exit callback: a second answer to "did this turn fail?" would be
  one to keep in step.
- **A child the runtime ends itself emits nothing more.** `closeThread` (the
  host abandoning a turn), a reap and `shutdown` unregister the session first,
  and the turn it was running is the host's to settle. `closeThread` sends
  `session/cancel` so the agent can stop its own tools, then SIGTERM once the
  prompt settles or `SESSION_SHUTDOWN_GRACE_MS` passes, then SIGKILL after the
  same grace.
- **A cancel is an ask, and the turn still ends through its prompt.**
  `cancelTurn` sends `session/cancel` and returns; the agent answers the prompt
  `cancelled`, which the mapper turns into interrupted items and an interrupted
  `turn/completed`, so a stopped turn settles through the same path as any
  other. From the cancel on, every permission request the turn holds or raises
  is answered `cancelled`, as the protocol requires, whatever the host's own
  answer would have been. An agent that never answers is the host's to close.
- **Nothing here remembers.** Claude Code and Codex carry their own memory; the
  repo's decision record retired a third beside them.

## Seams

- `AgentRuntimeOptions` (`types.ts`) — `onEvent` (every `ProviderEvent`),
  `onInteractiveRequest` (a permission request as a `PendingInteractionCreate`,
  answered with a `PendingInteractionResolution`), `onStderr`, and the two
  getters above.
- `AcpAgentRuntimeOptions.spawnAdapter` (`acp/acp-runtime.ts`) — the one
  injection point for how an adapter starts, handed the harness, its env and
  the workspace to run in, and answering an `AdapterProcess`: node's own
  `ChildProcess` or a host's stand-in. The server's suites spawn
  `test-support/fake-acp-agent.mjs` through it, and the desktop shell's server
  has main fork each adapter as a utility process through it. A harness row's
  `adapterEnv` rides every spawn unless the host's env names it already.
- `HARNESSES` — read by the server's status probe for "is the CLI on PATH, is a
  credential present, what is the login command"; the prompt and env are the
  host's own projections of its session facts.

## Testing

```bash
pnpm --filter @repo/agent-runtime test
```

`src/acp/__tests__/acp-mapping.test.ts` pins the pure halves: session
notifications onto the provider-event grammar (one message item per turn,
thoughts as one reasoning item, plans, edit-kind calls as `fileChange`, content
replaced rather than appended, a failed tool, codex's shell commands as
`commandExecution` with their raw output, notices and codex's warning chunk as
`provider/notice`, cancellation interrupting open items, every non-`end_turn`
stop but a cancel failing the turn, a prompt rejection failing through the
grammar) and permission requests onto the pending-interaction contract;
`provider-error.test.ts` pins the auth hint.

`src/acp/__tests__/acp-transcripts.test.ts` replays what the pinned adapters
REALLY sent — `fixtures/<adapter>@<version>/*.ndjson`, one live turn per
scenario (a reply, a plan request, a new file and an edit, a command, a failed
command) — through the SDK's own client and the mapper, snapshots the event
stream and the approval payloads, and asserts the write set an edit turn
reports, the output each command item carries, and that no adapter warning
reaches the message. The fake agent encodes beliefs about the adapters; these
encode the adapters. Bumping an adapter pin re-records them, which spends real
model calls and needs both vendors signed in:

```bash
pnpm --filter @repo/agent-runtime record:transcripts   # or: … claude | codex
pnpm --filter @repo/agent-runtime test -u              # after reading the snapshot diff
```

The recorder scrubs the vault path, the home dir, the session id and emails,
empties the vendor's command list (the user's installed skills) and drops the
adapters' `_`-prefixed extension notifications, which carry the signed-in
account and which no handler reads. The process half — spawning, `initialize`,
`session/new`, `session/load`, a cancel the agent answers and one it ignores, a
close after the watchdog, an adapter crashing
at boot or mid-prompt, an adapter refusing for auth as a session opens or at
the prompt — is exercised by the server's
`apps/cli/src/server/agents/__tests__/acp-manager.test.ts` against the fake
agent, because the assertions there are about what the host does with the
events.
