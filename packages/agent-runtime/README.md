# @repo/agent-runtime

The ACP agent runtime: one adapter speaks the Agent Client Protocol
(`@agentclientprotocol/sdk`) to a `claude-agent-acp` or `codex-acp` child,
harnesses are data rows, and what comes back is translated into the runtime's
own provider-event grammar. A consumer
says "start a session, run a turn, give me events" and never touches a process
or a wire format.

## Why it exists

The product drives an agent it does not own, on the user's own Claude or
ChatGPT plan. Two harnesses exist today and both speak ACP, so the seam between
"the server's thread service" and "a vendor's runtime" is one adapter over one
protocol, and adding a harness is a row in a table rather than a second
runtime. What the server needs from that seam
is small — an `AgentRuntime` with `startThread`, `resumeThread`, `runTurn`,
`hasThread`, `cancelTurn`, `closeThread`, `shutdown` (`types.ts`) — and the interface carries only what the host calls, because a
method kept for a re-vendor is a stub every test double must write.

The package is node-side by definition (it spawns processes), so nothing it
exports may pull a process tree into a page: the grammars a client reads
live in `@repo/domain`, and this package reaches `@repo/domain` alone (its
`DECLARED_EDGES` row in `tools/repo-guards/src/dep-dag.test.ts`) and never
react (`oxlint.config.ts`). Its one consumer is the `inteligir` server —
`apps/cli/src/server/agents/runtime-manager.ts` composes it.

## Layout

```
src/
  types.ts             # the AgentRuntime interface and its option/arg shapes —
                       # only what the host calls
  acp/
    acp-runtime.ts     # createAcpAgentRuntime: one adapter child per thread,
                       # the ACP client handlers, session open/load/close/reap;
                       # and what every adapter spawn shares: its env
                       # (adapterSpawnEnv), its stdio channel, its termination
    acp-sign-in.ts     # runAgentSignIn: an adapter started for one agent-kind
                       # sign-in (`authenticate`), then ended
    harness-registry.ts  # HARNESSES — claude and codex as rows: adapter entry,
                       # bundled vendor executable, account probe, sign-in
                       # method and sign-out args, model application, env
                       # keys to omit, what keeps the vault's own config
                       # out of a session (sessionMeta, refusedVaultEntries),
                       # and whether it declares typed failures
    acp-event-mapping.ts  # AcpTurnMapper: one session's notifications → the
                       # provider-event grammar, with the turn's item ids
    acp-permission-mapping.ts  # requestPermission ↔ @repo/domain's approval
                       # payload and resolution
    provider-error.ts  # readProviderError: a refusal's class and the
                       # adapter's own message; readSessionFailure: the same
                       # for a typed failure on a prompt's answer
  vocabulary/
    provider-event.ts  # ProviderEvent — the runtime's EMITTED grammar
  thread-shell-environment.ts  # stamps INTELIGIR_THREAD_ID onto a spawn's env
  test-support/
    fake-acp-agent.mjs # a scripted ACP agent (FAKE_ACP_MODE) the server's
                       # runtime-manager and sign-in suites spawn in place of
                       # a vendor
scripts/
  record-acp-transcripts.ts  # live turns through the runtime against the
                       # pinned adapters, scrubbed into the replay fixtures
```

## Invariants

- **ACP has no turn ids and no steering, so a turn is the host's id over one
  prompt.** A prompt's response is the turn's end and a prompt owns its session
  until it settles; `runTurn` takes the host's `turnId`, opens an
  `AcpTurnMapper` on it, emits `turn/started`, and resolves once the prompt is
  on the wire rather than when it settles, because the send must return while
  the turn streams. Every event and permission request the prompt raises
  carries that id, so a turn has one id space (`CONTEXT.md` "turn"). A
  mid-turn message waits in the host's queue.
- **`ProviderEvent` is exactly what `AcpTurnMapper` constructs, and is never
  parsed.** Types only, and no wider than the mapper: a kind or field no code
  here produces is a branch every consumer would carry for nothing. The server
  narrows it onto `ThreadEvent` in `@repo/domain` in
  `apps/cli/src/server/agents/event-mapping.ts`, every kind but a notice, which
  only the agent log reads. An update the grammar carries nothing of (a plan, a
  tool call still running, a usage count) maps to no event, and `onActivity`
  tells the host the session spoke, so its idle clock still hears a long tool
  call. `CONTEXT.md` "event means four things" holds the four layers apart.
- **A harness is a data row.** `HARNESSES` names the adapter entry resolved
  through `require.resolve`, the vendor executable (`vendorExecutable(env)`:
  the override the adapter honours, `CLAUDE_CODE_EXECUTABLE` or `CODEX_PATH`,
  else the native binary bundled beside the adapter, resolved the way the
  adapter itself resolves it; never PATH, and null when an override names
  nothing), the account probe (the vendor's own status command, and the parse
  of its answer into signed in, signed out or unknown), how a model is applied
  (an env var for either: `ANTHROPIC_MODEL`, or a `CODEX_CONFIG` the codex
  adapter merges into every session) and the env keys to omit — the claude SDK
  refuses to run when it believes it is nested inside another claude session,
  so the nesting sentinel must not leak through from whatever launched this
  app. The id set and the names a person reads (`HARNESS_IDS`,
  `harnessIdSchema`, `HARNESS_NAMES`) are `@repo/domain/harness`'s, so the
  wire and every runtime call take a `HarnessId` and `HARNESSES` is indexed by
  one, never by a string. A thread's own provider id stays open in its row and
  its log, since another device's newer build may name a harness this one does
  not ship, and the host narrows it with `parseHarnessId` where a turn starts.
  A model is per harness (`models`, a `HarnessModels`),
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
- **A session is handed no MCP servers; the vendor's own config names them.**
  `session/new` and `session/load` send `mcpServers: []`, so a claude session
  loads the user-scope servers its `settingSources` reach and codex its
  `config.toml`, and `adapterSpawnEnv` passes `HOME`, `CLAUDE_CONFIG_DIR` and
  `CODEX_HOME` through untouched, so that config is the one the user's own
  `claude mcp` and `codex mcp` edit. A list injected beside it would be a
  second source of truth for one question
  (`packages/agent-runtime/src/acp/__tests__/spawn-env.test.ts`,
  `packages/agent-runtime/src/acp/__tests__/vault-config-isolation.test.ts`).
- **No configuration inside the vault reaches a session.** The vault is synced
  content, so a claude session opens with `settingSources: ["user"]` (the
  row's `sessionMeta`): `project` and `local` would read the vault's `.claude`
  settings and `.mcp.json`. codex-acp marks its root trusted, so a pnpm patch
  marks it untrusted, and since npm applies no patch, a codex session also
  refuses a vault holding `.codex` (`refusedVaultEntries`).
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
  for a notice yet, so it writes the notice's text to the agent log alone.
- **A permission answer is one of the agent's own option ids.** The exact kind
  first, then the same allow/reject family; no offered option answers
  `cancelled`. An unrecognised tool kind falls back to the command subject,
  because the contract has no "other".
- **A refusal is read into a class and the adapter's own words, and the host
  words it.** The SDK rejects a refused request with a `RequestError` (an
  Error carrying the JSON-RPC `code`); `readProviderError` classes it (an auth
  refusal is `-32000` or an `errorKind` naming a sign-in) and keeps the
  adapter's message beside the class. What a person reads of an auth or a
  usage-limit refusal, and that the queue waits behind one, is the host's
  policy, so the host writes those words
  (`apps/cli/src/server/threads/provider-failure.ts`), never this package.
- **A codex turn fails by its typed failure, never by its stop reason.** A
  row with `typedFailures` (codex alone) declares codex-acp's typed session
  failures on `initialize`, and a prompt answered with one fails its turn
  through `readSessionFailure`, its category and actions read into the same
  classes: access is signed out, a limit only a new session clears the
  context, any other limit the plan's. Undeclared, codex speaks every failure
  but a usage limit or a sign-in as the agent's own text and answers
  `end_turn`, so an overflowed context read as a finished reply. Claude stays
  undeclared: declared, it would stop rejecting a limited turn with the
  `errorKind` its refusal is classed by.
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
  `session/cancel` so the agent can stop its own tools, and ends the child once
  the prompt settles or `ADAPTER_STOP_GRACE_MS` passes.
- **An adapter is ended the way it ends itself, and its process group goes
  with it.** Every adapter is spawned detached, so it leads a group of its own.
  `terminateAdapter` ends its stdin first, on which both pinned adapters stop
  their own child (codex-acp its app-server, claude-agent-acp its CLI, each
  given 2s) and exit, where codex-acp exits on a SIGTERM without stopping its
  app-server. SIGTERM follows once `ADAPTER_STOP_GRACE_MS` passes, and after
  `SIGTERM_GRACE_MS` SIGKILL goes to the whole group, whether or not the
  adapter has exited, since a child of the adapter's can outlive it there. The
  wait after the SIGKILL is bounded too, so no caller hangs on an exit that
  never arrives. The server's own death needs nothing more: its adapters sit
  outside its group, and its death closes their stdin. `ADAPTER_TEARDOWN_MS` is
  the whole sequence, which the server's agent shutdown budget holds twice (a
  sign-in's, then the sessions'). Rejected: a SIGTERM with a SIGKILL a second
  behind it, which cut both adapters' own shutdown short and left codex's
  app-server running.
- **A cancel is an ask, and the turn still ends through its prompt.**
  `cancelTurn` sends `session/cancel` and returns; the agent answers the prompt
  `cancelled`, which the mapper turns into interrupted items and an interrupted
  `turn/completed`, so a stopped turn settles through the same path as any
  other. From the cancel on, every permission request the turn holds or raises
  is answered `cancelled`, as the protocol requires, whatever the host's own
  answer would have been. An agent that never answers is the host's to close.
- **A sign-in is the method the adapter advertises, and it never outlives
  itself.** A harness row's `signIn` names it: a `terminal` method (claude's
  `claude-ai-login`) is the client's to run, so the server runs the vendor
  binary with the row's args itself, and the row's `acceptsCode` is the
  vendor's own test for a code pasted from its page; an `agent` method (codex's `chat-gpt`) is
  `runAgentSignIn`'s. That starts the adapter on the env a session gets
  (`adapterSpawnEnv`, so the two cannot disagree), initializes with
  `auth.terminal` so every method is advertised, refuses a method it does not
  find before asking for it, sends `authenticate`, and ends the child the way a
  close does (`terminateAdapter`) once it settles or its signal aborts. `src/acp/__tests__/acp-sign-in.test.ts` runs the fake agent
  through it and asks the pinned adapters what they advertise.
- **Nothing here remembers.** Claude Code and Codex carry their own memory; the
  repo's decision record retired a third beside them.

## Seams

- `AgentRuntimeOptions` (`types.ts`) — `onEvent` (every `ProviderEvent`),
  `onActivity` (every update the running turn's session sends, so the host's
  idle clock hears one that maps to no event), `onInteractiveRequest` (a
  permission request as a `PendingInteractionCreate`, answered with a
  `PendingInteractionResolution`), `onStderr`, and the `shellEnv` getter above.
- `AcpAgentRuntimeOptions.spawnAdapter` (`acp/acp-runtime.ts`) — the one
  injection point for how an adapter starts, handed the harness, its env and
  the workspace to run in, and answering the `ChildProcessWithoutNullStreams`
  it spawned, detached as `spawnNodeAdapter` spawns one, since the teardown
  kills its process group. Absent, `spawnNodeAdapter` runs the harness's
  adapter entry on this node. The server's suites spawn
  `test-support/fake-acp-agent.mjs` through it, and the transcript recorder
  taps the pinned adapters' stdout through it. A harness row's `adapterEnv`
  rides every spawn unless the host's env names it already.
- `HARNESSES` — read by the server for "is the runtime bundled", "what
  does the vendor say of its sign-in" and "how does it sign in and out"; the
  server runs the account probe, a terminal sign-in and a sign-out through its
  one vendor spawn policy (`apps/cli/src/server/agents/vendor-process.ts`), and
  an agent sign-in through `runAgentSignIn`, which starts and ends its adapter
  as a session does. The prompt and env are the host's own projections of its
  session facts.

## Testing

```bash
pnpm --filter @repo/agent-runtime test
```

`src/acp/__tests__/acp-mapping.test.ts` pins the pure halves: session
notifications onto the provider-event grammar (a message or a reasoning item
per spoken run, split where the messageId changes or a tool call opens, a plan
mapping to nothing, edit-kind calls as `fileChange`, content
replaced rather than appended, a failed tool, codex's shell commands as
`commandExecution` with their raw output, notices and codex's warning chunk as
`provider/notice`, cancellation interrupting open items, every non-`end_turn`
stop but a cancel failing the turn, a prompt rejection failing through the
grammar) and permission requests onto the pending-interaction contract;
`provider-error.test.ts` pins how a refused prompt and a typed failure are
classed (signed out, the plan's usage limit, overload, context, other).

`src/acp/__tests__/acp-transcripts.test.ts` replays what the pinned adapters
REALLY sent — `fixtures/<adapter>@<version>/*.ndjson`, one live turn per
scenario (a reply, a plan request, a new file and an edit, a command, a failed
command, and for codex a context overflow) — through the SDK's own client and
the mapper, settling each answer as the runtime does, snapshots the event
stream and the approval payloads, and asserts the write set an edit turn
reports, the output each command item carries, that no adapter warning
reaches the message, and that codex's overflow fails its turn as `context`
rather than speaking the error. The fake agent encodes beliefs about the
adapters; these encode the adapters. Bumping an adapter pin re-records them,
which spends real model calls and needs both vendors signed in:

```bash
pnpm --filter @repo/agent-runtime record:transcripts   # or: … claude | codex [scenario…]
pnpm --filter @repo/agent-runtime test -u              # after reading the snapshot diff
```

A failure no prompt causes on demand is a `staged` scenario: codex runs over a
scratch `CODEX_HOME` whose one model provider is a local endpoint streaming
what the API streams for that failure, so it needs no sign-in and spends
nothing, and the adapter and vendor binary are still the pinned ones. Naming
scenarios rewrites only their files.

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
events. How an adapter is ended (one that stops at its stdin's end, one wedged,
one that exits leaving its child behind) is
`src/acp/__tests__/adapter-teardown.test.ts`'s, which reads the adapter's
process group back.
