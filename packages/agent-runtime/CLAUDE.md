# Decisions: @repo/agent-runtime

The ACP runtime's wire and what a session is handed. `AGENTS.md` § Decisions
says how a bullet is written and cited.

## Agents and threads

- **THE PROVIDER GRAMMAR IS WHAT THE ACP MAPPER EMITS, AND THE MAPPER IS PINNED
  TO THE ADAPTERS' REAL WIRE** (owner decision). `ProviderEvent` carries exactly
  what `AcpTurnMapper` constructs, since a kind nothing produces is a branch
  every consumer carries. The rule holds for the persisted `ThreadEvent` too: it
  carries what the mapper emits as the host narrows it, plus the host's own
  facts, so an update no adapter sends (a plan) or one the timeline would only
  drop (a tool call still running) maps to nothing, and the runtime's
  `onActivity` keeps the idle watchdog hearing it. The mapper is tested against
  turns the pinned adapters really sent
  (`packages/agent-runtime/src/acp/test-support/fixtures/<adapter>@<version>/`),
  because a fake agent encodes what the adapters were believed to send. A
  failure no prompt causes on demand is staged: codex is pointed at a local
  model endpoint answering as the API does (a scenario's `staged`), so the
  adapter and the vendor binary are still the pinned ones. The adapter and SDK
  pins are exact and move together, and a bump re-records
  (`packages/agent-runtime/scripts/record-acp-transcripts.ts`).

- **NO CONFIGURATION INSIDE THE VAULT RUNS ON THE AGENT'S HOST.** The vault is
  synced content (the hosted remote, a BYO remote, another device's pull).
  Claude sessions open with `settingSources: ["user"]`, the claude row's
  `sessionMeta` (`packages/agent-runtime/src/acp/harness-registry.ts`), because
  `project` and `local` read the vault's `.claude` settings and `.mcp.json`;
  CLAUDE.md and the vault-keyed MCP servers in `~/.claude.json` sit behind the
  same two gates, so they go too. codex-acp marks the session root trusted and
  takes no per-session option, so a pnpm patch marks it untrusted
  (`pnpm-workspace.yaml` names it), which also stops Codex reading the vault's
  AGENTS.md itself; the server's instructions already carry that file to both
  harnesses (`apps/cli/src/server/agents/agent-instructions.ts`). npm applies no
  pnpm patch, so a Codex session also refuses to open on a vault holding
  `.codex` (the row's `refusedVaultEntries`). Rejected: keeping a vault source
  and refusing its executing keys one by one, a list every vendor release can
  outgrow. User-level vendor config stays.
  `packages/agent-runtime/src/acp/vault-config-isolation.test.ts` runs
  each pinned adapter against a fake vendor and reads what it was handed.
