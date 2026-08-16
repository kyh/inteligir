# Vendored: bb agent-runtime (codex slice)

- **Upstream**: https://github.com/get-bb/bb, directory
  `packages/agent-runtime` (plus the domain modules it leans on from
  `packages/domain`, vendored under `src/domain/`)
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — © bb contributors (attribution header on every vendored
  file)
- **Vendored**: 2026-08-16

Vendored rather than depended on because bb publishes no packages and this
repo carries only the codex slice of a three-provider runtime. Files keep
upstream's names and layout so a re-vendor diffs cleanly. House-authored
files in this package: `src/thread-shell-environment.ts` (rewritten around
INTELIGIR_* variables), `src/domain/reasoning-efforts.ts` (constants folded),
and everything under `src/test-support/` and `__tests__/`.

## Not carried (the trims), each with its consumer

- **`claude-code/`, `pi/`, `acp/` adapters** and every bridge-process
  mechanism (bundled bridges, `bridgeNodeExecutablePath`, sdk/message
  envelopes, ACP launch-spec fingerprints). Codex is the in-process protocol
  adapter — the one provider this deployment runs (issue #549).
- **Skills configuration** (`runtime-skill-roots.ts`, `skills/configure`).
- **Fork / rewind staging** (`prepareThreadRewind`, staged leases,
  `thread/fork`, `thread/discard`, suppressed staging thread ids).
- **Dynamic tools and tool-call routing** (`onToolCall`,
  `decodeToolCallRequest`, `shared/bridge-tool-calls`,
  `shared/provider-tool-call-contract`). No dynamic tools are registered;
  the agent reaches the product through the CLI (issue #553), not through
  provider tool calls.
- **Goals, background-work state, archive/unarchive, rename (and its rollout
  retries), thread compaction commands, `turn/input/accepted` correlation
  (`clientRequestId`), service tiers, claude-code execution knobs.** No
  producer or renderer here.
- **Raw-response shell-output recovery** (`rawResponseItem/completed` repair,
  `experimentalRawEvents`). Cost: codex's normalized `commandExecution`
  output is what the timeline shows, including any provider-side truncation.
- **Sub-agent / collab-agent delegation linking**
  (`subagent-activity-translation.ts`, `parentToolCallId` plumbing). Instead
  the adapter forces `features.multi_agent = false`, so child turns cannot
  exist to be mis-attributed.
- **Rate-limit surfacing** (`account/rateLimits` state and
  `provider/rateLimits/updated`). The account-restart heuristic that
  consumed it survives on the error text/category alone.
- **Git-writable-roots hardening** in the codex adapter (~550 lines). bb
  needs it for linked worktrees whose git dir lives OUTSIDE the workspace;
  the vault's `.git` is inside the workspace root, which workspace-write
  already covers.
- **Codex memories** are configured OFF (`memories.use_memories/generate`),
  where bb defaults them on: an unattended vault agent silently accreting
  provider-level state in `~/.codex` would be surprising.
- **Archived-session recovery** in `sendCommand` (unarchive-and-retry):
  archiving is not carried.
- **`@bb/process-utils`** (cross-spawn portability, env sanitizing,
  diagnostics): providers spawn via `node:child_process` directly; Windows
  is not a target yet.
- **`normalizeProviderThreadNameEvent`**: thread-name normalization served
  bb's picker; name events are dropped by this repo's consumer.
- The generated codex app-server schema is pruned to the transitive
  type-import closure of the kept importers (33 files of upstream's ~336) —
  same policy as upstream's own README. `visibility.ts` is patched to derive
  its method union from its own table instead of the generated
  `ServerNotification`, whose closure is most of the generated tree.

## Local patches (beyond the trims)

- Every file: attribution header prepended; `@bb/domain` imports point at
  `src/domain/` (or `@repo/domain/thread-event-scope`, whose scope schema is
  the identical vendored shape both grammars share).
- `src/domain/provider-event.ts` is the provider grammar as TYPES — the
  runtime constructs events, it never parses them; parsing happens where
  events cross into the host (`apps/app/src/node/agent/event-mapping.ts`).
- **No type assertions anywhere** (house rule): `UNSTAMPED_THREAD_ID` loses
  upstream's unique-symbol brand; `codex/models.ts` reads loose fields
  through record guards and carries `noUncheckedIndexedAccess` fallbacks;
  `z.ZodIssueCode.custom` became the zod-v4 `"custom"` literal.
- `runtime-turn-state.ts`: the `parentToolCallId` child-turn guard is gone
  with delegation linking.
- `codex/interactive-requests.ts`: the plan-review subject branch is gone
  with the trimmed payload union (claude-code's ExitPlanMode; upstream's
  branch only threw for codex).
- `item/reasoning/summaryTextDelta` was re-vendored INTO `@repo/domain`'s
  persisted grammar (with its scope-policy row and timeline handling): codex
  streams the visible thinking text as summary deltas, so its producer has
  landed.

## Re-vendor recipe

Diff upstream's `packages/agent-runtime/src` at a newer commit against this
directory ignoring headers; consult the trim list above before carrying a
new feature in (each needs its consumer). Regenerate + re-prune
`codex/generated/` per its README. Update the commit pin here and run
`pnpm --filter @repo/agent-runtime test`.
