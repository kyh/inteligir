# Vendored: bb agent-runtime (codex slice)

- **Upstream**: https://github.com/get-bb/bb, directory
  `packages/agent-runtime` (plus the domain modules it leans on from
  `packages/domain`, vendored under `src/domain/`)
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — `LICENSE.bb` in this directory is upstream's own text,
  copied verbatim. The per-file notice below is not a substitute for it: MIT
  requires the license itself to travel with the copy, and it names a
  copyright holder no notice line carries.
- **Vendored**: 2026-08-16

Vendored rather than depended on because bb publishes no packages and this
repo carries only the codex slice of a three-provider runtime. Files keep
upstream's names and layout so a re-vendor diffs cleanly. House-authored
files in this package: `src/thread-shell-environment.ts` (rewritten around
INTELIGIR_* variables), `src/domain/reasoning-efforts.ts` (constants folded),
and everything under `src/test-support/` and `__tests__/`.

## Attribution

MIT requires the notice to travel with the copy, so every vendored file carries
the line below — `tools/repo-guards/src/vendor-provenance.test.ts` reads it and
the exemption list from here, and checks the tree against both.

```text
Vendored from bb (github.com/get-bb/bb), MIT.
```

Exempt paths, each with the reason it carries a different header (or none):

```text
src/codex/generated/**   the generator's own ts-rs header, kept byte-faithful to `codex app-server generate-ts` so a regenerate diffs cleanly — generated FROM the codex binary, not authored by bb
src/test-support/**      house-authored
src/__tests__/**         house-authored
vitest.config.ts         house scaffolding; the vendored surface is src/
```

## Not carried (the trims), each with its consumer

- **`claude-code/`, `pi/`, `acp/` adapters** and every bridge-process
  mechanism (bundled bridges, `bridgeNodeExecutablePath`, ACP launch-spec
  fingerprints, the post-initialize hydration hook). Codex is the in-process
  protocol adapter — the one provider this deployment runs (issue #549).
  Two bridge shapes DO survive and are kept rather than trimmed: the
  sdk/message envelope's first arm in `codexBridgeEnvelopeSchema`
  (`codex/schemas.ts`), which arm two already subsumes, and
  `shared/json-rpc-envelope.ts` behind it.
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
  (`clientRequestId`), service tiers, claude-code execution knobs and the
  live-vs-session settings classifier they were the only `live` case of.** No
  producer or renderer here. `thread/archived` / `thread/unarchived` are not
  in the handled schema either; `visibility.ts` classes both as noise, which
  is where an archive notification is dropped.
- **Attachments** (`localFile` prompt input). Codex has no counterpart input
  type, so the adapter could only fake one as text.
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
  bb's picker. The name event itself IS carried end to end here — schema,
  translation and a `thread/name/updated` emission — and is dropped one layer
  later, by `apps/app/src/node/agent/event-mapping.ts`.
- **Error categories with no codex source**: `billing`, `budget-exceeded`,
  `max-output-tokens`, `max-turns`, `structured-output-retries`, and
  `provider/warning`'s `general`. `getProviderErrorCategory` is total over
  codex's own `CodexErrorInfo` and produces none of them.
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
