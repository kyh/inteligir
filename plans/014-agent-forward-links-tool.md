# Plan 014: Expose forward links (and related notes) to the chat agent as a knowledge tool

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- packages/features/src/server/agent/knowledge packages/core/src/knowledge`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

The chat agent can search the vault (`search_vault`) and see what points AT a note (`get_backlinks`), but it cannot traverse OUTWARD from a note — the resolved forward-link set. That's the move behind "summarize everything this note references" and "what's related to this?". The capability already exists and is already resolved/alias-normalized in the knowledge index (`forwardLinks`), and it is _only_ reachable through the index — the agent's raw file tools see `[[links]]` as text, not as resolved paths. So this is one tool registration over a method that's already built, tested, and wired to the host. It is the cheapest real capability increase available to the agent.

## Current state

- `packages/core/src/knowledge/knowledge-index.ts:172-186` — `forwardLinks(path): ForwardLinkEntry[]` already exists beside `backlinks`, returning `{target, targetPath, line, snippet, kind, embed, alias?}` entries:

```ts
forwardLinks(path: string): ForwardLinkEntry[] {
  const links = this.ensureResolved().forward.get(path) ?? [];
  return links.map(({ link, targetPath }) => {
    const entry: ForwardLinkEntry = {
      target: link.target,
      targetPath,
      line: link.line,
      snippet: this.lineSnippet(path, link.line),
      kind: link.kind,
      ...
```

- `packages/features/src/server/knowledge/knowledge-manager.ts:59-62` — the host shell ALREADY exposes it:

```ts
forwardLinks(vaultPath: string): ForwardLinkEntry[] {
  this.ensureBuilt();
  return this.index.forwardLinks(vaultPath);
}
```

- `packages/features/src/server/agent/knowledge/extension.ts:85-99` — the agent bundle registers only `search_vault` and `get_backlinks`. The exemplar to copy (`get_backlinks`, verbatim):

```ts
pi.registerTool({
  name: "get_backlinks",
  label: "get_backlinks",
  description:
    "Notes that link TO the given vault-relative note path (wiki-links and markdown links).",
  parameters: GetBacklinksSchema,
  execute: async (_toolCallId, params: Static<typeof GetBacklinksSchema>) => {
    const hits = ports.knowledge.backlinks(params.path);
    if (hits.length === 0) return textResult("No backlinks.");
    // De-dupe by source path — a note can link to the target on several
    // lines, but the agent only needs the set of linking notes.
    const paths = [...new Set(hits.map((hit) => hit.sourcePath))];
    return textResult(paths.join("\n"));
  },
});
```

- `ports.knowledge` is the injected `AgentPorts` capability (extension bundles receive ports at register time — `packages/features/src/server/agent/bundles.ts` is the static registry with a disk-drift test). Check whether the `knowledge` port type already surfaces `forwardLinks`; if not, widen the port type to include it (the KnowledgeManager already implements it).
- **Hard constraint**: `validateToolParametersSchema` rejects tool schemas that aren't a top-level `Type.Object` — OpenAI silently rejects `anyOf`-rooted schemas. Model the new schema exactly like `GetBacklinksSchema` (find it at the top of `extension.ts`).
- Tool naming convention in this bundle: snake_case (`search_vault`, `get_backlinks`).

## Commands you will need

| Purpose        | Command                                                                              | Expected |
| -------------- | ------------------------------------------------------------------------------------ | -------- |
| Format         | `pnpm format:fix` (FIRST)                                                            | exit 0   |
| Typecheck      | `pnpm typecheck`                                                                     | exit 0   |
| Features tests | `pnpm --filter @repo/features test`                                                  | all pass |
| Full gates     | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Scope

**In scope**:

- `packages/features/src/server/agent/knowledge/extension.ts` — register `get_links`
- The `AgentPorts` knowledge port type (wherever it's declared — grep `ports.knowledge` / `AgentPorts`) if it needs widening
- `packages/features/src/server/__tests__/` — a test for the new tool's execute path

**Out of scope**:

- `packages/core/**` — `forwardLinks` is already correct; do not touch the index.
- `search_vault` / `get_backlinks` behavior — unchanged.
- A `related_notes` (shared-neighbor ranking) tool — deliberately deferred; see maintenance notes. Ship the primitive first.
- Any Bridge/IPC channel — this is agent-side only, no renderer surface.
- A `web_search` tool — the `browser` bundle already gives the agent web navigation; not needed.

## Git workflow

- Branch: `kyh/plan-014-agent-forward-links-tool`
- Conventional commit, e.g. `feat(agent): expose forward links as a knowledge tool`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm the port surfaces forwardLinks

`grep -rn "AgentPorts" packages/features/src/server/agent/` and read the knowledge port's type. If it only declares `search`/`backlinks`, add `forwardLinks(vaultPath: string): ForwardLinkEntry[]` to the port type — `KnowledgeManager` already implements it, so the composition root should need no change.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Register `get_links`

In `extension.ts`, add a `GetLinksSchema` mirroring `GetBacklinksSchema` (top-level `Type.Object` with a `path` string — copy its shape and description style exactly), then register:

- name/label: `get_links`
- description: describe it as the notes this note links TO (wiki-links and markdown links), resolved to vault-relative paths — the outbound direction of `get_backlinks`.
- execute: call `ports.knowledge.forwardLinks(params.path)`; on empty → `textResult("No links.")`; otherwise return one line per link. Include the resolved `targetPath` (that's the useful part — a raw `[[target]]` the agent could have read from the file itself). **Unresolved links matter**: `targetPath` may be null/undefined for a dangling link — render those distinctly (e.g. `target (unresolved)`) rather than dropping them or emitting `undefined`. Check `ForwardLinkEntry`'s exact type for how a dangling target is represented and handle it explicitly (no `!`, no `as`).
- De-dupe by resolved target path, mirroring `get_backlinks`' de-dupe comment/rationale.

**Verify**: `pnpm typecheck` → exit 0; `pnpm lint` → exit 0.

### Step 3: Test

Add a test alongside the existing agent/knowledge extension tests (find them: `grep -rln "get_backlinks" packages/features/src`). Cover: a note with resolved links → the tool returns their target paths; a note with no links → "No links."; a note with a dangling `[[nonexistent]]` → rendered as unresolved, not dropped, no `undefined` in the output string.

**Verify**: `pnpm --filter @repo/features test` → all pass including the new test.

### Step 4: Gates

`pnpm format:fix`, then full gates.

**Verify**: exit 0.

## Test plan

Covered in Step 3. If the bundles registry has a disk-drift test (it does — `bundles.ts` has one), confirm it still passes: this plan adds a tool to an EXISTING bundle, not a new bundle folder, so the registry shouldn't change. If the drift test fails, you've accidentally restructured the bundle — STOP.

## Done criteria

- [ ] `get_links` registered in the knowledge extension with a top-level `Type.Object` schema
- [ ] Dangling links render explicitly (grep the test asserting it)
- [ ] `pnpm --filter @repo/features test` green; full gates green
- [ ] Bundles disk-drift test still passes
- [ ] No files outside scope modified
- [ ] `plans/README.md` updated

## STOP conditions

- The knowledge port cannot be widened without touching the composition root in a non-obvious way — report rather than restructuring `AgentPorts`.
- `ForwardLinkEntry` has no representation for a dangling/unresolved link (meaning the index drops them) — report; the tool's contract depends on knowing whether an unresolved link is visible at all.
- The tool schema trips `validateToolParametersSchema` — that means you rooted it in something other than `Type.Object`; fix the schema, and if it still fails, STOP (the validator exists because OpenAI silently rejects such schemas — do not work around it).

## Maintenance notes

- Deliberately deferred: a `related_notes` tool (shared-neighbor / co-citation ranking over the graph). It's a genuine product idea but it's a ranking _design_ question, not a plumbing one — ship the primitive, then decide from agent transcripts whether ranking is needed.
- Also deferred (and deliberately NOT recommended): a `web_search` tool. The `browser` extension bundle already gives the agent web navigation; a search tool is a convenience, not a capability gap.
- Reviewer: check the tool description reads unambiguously against `get_backlinks` — the agent picks between them from the description alone, and "links" vs "backlinks" is exactly the pair a model confuses. Consider naming the tool `get_forward_links` if review finds the shorter name ambiguous.
