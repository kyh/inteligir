# Decisions: @repo/agent-runtime

The ACP runtime's wire and what a session is handed. `AGENTS.md` § Decisions
says how a bullet is written and cited.

## Agents and threads

- **THE PROVIDER GRAMMAR IS WHAT THE ACP MAPPER EMITS** (owner decision).
  `ProviderEvent` carries exactly what `AcpTurnMapper` constructs, and the
  persisted `ThreadEvent` what the mapper emits as the host narrows it, plus the
  host's own facts. So an update no adapter sends (a plan) or one the timeline
  would only drop (a tool call still running) maps to nothing, and the runtime's
  `onActivity` keeps the idle watchdog hearing it. Rejected: a kind nothing
  produces (a branch every consumer carries).
  `packages/agent-runtime/src/acp/acp-event-mapping.ts`.

- **THE MAPPER IS TESTED AGAINST TURNS THE PINNED ADAPTERS REALLY SENT** (owner
  decision), recorded under
  `packages/agent-runtime/src/acp/test-support/fixtures/<adapter>@<version>/`.
  A failure no prompt causes on demand is staged by pointing codex at a local
  model endpoint answering as the API does (a scenario's `staged`), so the
  adapter and vendor binary are still the pinned ones. The adapter and SDK pins
  are exact and move together, and a bump re-records
  (`packages/agent-runtime/scripts/record-acp-transcripts.ts`). Rejected: a fake
  agent (it encodes what the adapters were believed to send).

- **NO CONFIGURATION INSIDE THE VAULT RUNS ON THE AGENT'S HOST.** The vault is
  synced content (the hosted remote, a BYO remote, another device's pull);
  user-level vendor config stays. Claude sessions open with `settingSources:
  ["user"]` (the claude row's `sessionMeta` in
  `packages/agent-runtime/src/acp/harness-registry.ts`), because `project` and
  `local` read the vault's `.claude` settings and `.mcp.json` and gate its
  CLAUDE.md and the vault-keyed MCP servers in `~/.claude.json`. Rejected:
  keeping a vault source and refusing its executing keys one by one (a list
  every vendor release can outgrow).
  `packages/agent-runtime/src/acp/vault-config-isolation.test.ts` runs each
  pinned adapter against a fake vendor and reads what it was handed.

- **A CODEX SESSION OPENS THE VAULT UNTRUSTED, AND REFUSES ONE HOLDING
  `.codex`.** codex-acp marks the session root trusted and takes no per-session
  option, so a pnpm patch (named in `pnpm-workspace.yaml`) marks it untrusted,
  which also stops Codex reading the vault's AGENTS.md; the server's
  instructions carry that file to both harnesses
  (`apps/cli/src/server/agents/agent-instructions.ts`). npm applies no pnpm
  patch, hence the refusal (the harness row's `refusedVaultEntries` in
  `packages/agent-runtime/src/acp/harness-registry.ts`).
