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
  test-support/
    fake-acp-agent.mjs # a scripted ACP agent (FAKE_ACP_MODE) the server's
                       # runtime-manager and sign-in suites spawn in place of
                       # a vendor
scripts/
  record-acp-transcripts.ts  # live turns through the runtime against the
                       # pinned adapters, scrubbed into the replay fixtures
```

## Where the rules live

The decisions are the `CLAUDE.md` files': this package's (the provider grammar
pinned to the adapters' real wire, and no configuration inside the vault
reaching a session), and `apps/cli/src/server/agents/CLAUDE.md` for what the
host does with a session (a stop, a session it gives up on, a refused turn's
class, sign-in, connectors). Each mechanism's reason sits beside its code: a
turn as the host's id over one prompt and an adapter's teardown
(`acp-runtime.ts`), the turn's item ids and kinds (`acp-event-mapping.ts`), an
answer as one of the agent's own options (`acp-permission-mapping.ts`), a
refusal's class (`provider-error.ts`), and each field of a harness row
(`harness-registry.ts`). `CONTEXT.md` "event means four things" holds the four
layers apart.

## Seams

- `AgentRuntimeOptions` (`types.ts`) — the host's callbacks and the `shellEnv`
  getter.
- `AcpAgentRuntimeOptions.spawnAdapter` (`acp/acp-runtime.ts`) — the one
  injection point for how an adapter starts; absent, `spawnNodeAdapter` runs
  the harness's adapter entry on this node. The server's suites spawn
  `test-support/fake-acp-agent.mjs` through it, and the transcript recorder
  taps the pinned adapters' stdout through it.
- `HARNESSES` — read by the server for whether a runtime is bundled, what the
  vendor says of its sign-in, and how it signs in and out, which the server
  runs through its one vendor spawn policy
  (`apps/cli/src/server/agents/vendor-process.ts`), and `runAgentSignIn` for an
  agent-kind sign-in.

## Testing

```bash
pnpm --filter @repo/agent-runtime test
```

The mapper is tested twice: against hand-written notifications for the pure
halves, and against what the pinned adapters REALLY sent, replayed from
`src/acp/__tests__/fixtures/<adapter>@<version>/*.ndjson` through the SDK's
own client and snapshotted. The fake agent encodes beliefs about the adapters;
the transcripts encode the adapters. Bumping an adapter pin re-records them,
which spends real model calls and needs both vendors signed in, except a
staged scenario's (the recorder's header says how each is run):

```bash
pnpm --filter @repo/agent-runtime record:transcripts   # or: … claude | codex [scenario…]
pnpm --filter @repo/agent-runtime test -u              # after reading the snapshot diff
```

The process half, a session's spawn, open, cancel, close and crash, is
exercised by the server's agent suites against the fake agent, because the
assertions there are about what the host does with the events.
