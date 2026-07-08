# Plan 013: Feature — give the chat agent the knowledge engine (search + backlinks tools)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/features/src/server/agent packages/features/src/server/knowledge/knowledge-manager.ts`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2 (the "AI-native" differentiator)
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

The knowledge engine (lexical search, backlinks, link graph) exists — but only
the UI can use it. The chat agent greps the vault with `bash`, which is slow,
token-hungry, and blind to wiki-link semantics. Exposing `search_vault` and
`get_backlinks` as agent tools makes "find my notes about X and link them" a
one-tool-call operation. This is the product's core differentiation vs.
Obsidian-plus-a-plugin, and it is cheap: the registry pattern makes an
extension one folder + one line.

## Current state

- Bundle registry — `packages/features/src/server/agent/bundles.ts` (whole file):

  ```ts
  import browser from "./browser/extension";
  import executor from "./executor/extension";
  import peekaboo from "./peekaboo/extension";
  import type { PiExtensionBundle } from "./extension";

  export const EXTENSION_BUNDLES: PiExtensionBundle[] = [browser, executor, peekaboo].toSorted(
    (a, b) => a.name.localeCompare(b.name),
  );
  ```

  Its header: "Adding an extension = one folder + one line here —
  `__tests__/bundles.test.ts` fails if a folder is missing from the list."

- Ports contract — `packages/features/src/server/agent/extension.ts`:
  `AgentPorts = { executor: ExecutorPort }`, handed to bundles at register
  time via `ExtensionRegisterContext = { binDir, ports }`. Header comment:
  "agent/ never imports @/main/\*; main/lib/agent-lifecycle.ts builds these
  (structural subsets of the main singletons) and passes them down. ... only
  capabilities that can't be expressed as plain filesystem access need one."
  The knowledge index is derived state OUTSIDE the vault — exactly such a
  capability.

- Initial tools — `packages/features/src/server/agent/agent.ts`:
  `INITIAL_ACTIVE_TOOLS = ["read", "bash", "edit", "write"]`; "Extension tools
  (execute, browser, …) activate as they register."

- Knowledge surface (what the port wraps) —
  `packages/features/src/server/handlers/knowledge-handlers.ts`:

  ```ts
  handle("getBacklinks", ({ path }) => getKnowledgeManager().backlinks(path));
  handle("searchVault", ({ query, limit }) => getKnowledgeManager().search(query, limit));
  ```

- Tool-schema constraint (documented in CLAUDE.md): `validateToolParametersSchema`
  rejects tool schemas that aren't a top-level `Type.Object` (OpenAI silently
  rejects `anyOf`-rooted schemas). Find where existing bundles define tool
  schemas (read `browser/extension.ts` for the pattern) and match it.

- IMPORTANT unknown to resolve in Step 1: `AgentPorts` is constructed by the
  DESKTOP main process (`agent-lifecycle.ts` in `apps/desktop/src/main/`), and
  possibly ALSO wherever the delegation background agent gets its ports
  (`packages/features/src/server/delegation/background-agent.ts`). Every
  construction site must supply the new port.

## Commands you will need

| Purpose        | Command                             | Expected                                                      |
| -------------- | ----------------------------------- | ------------------------------------------------------------- |
| Features tests | `pnpm --filter @repo/features test` | pass                                                          |
| Typecheck/lint | `pnpm typecheck && pnpm lint`       | exit 0                                                        |
| Real app       | `pnpm dev:desktop`                  | boots; requires pi/OpenAI login on this machine for live chat |

## Scope

**In scope**:

- NEW `packages/features/src/server/agent/knowledge/extension.ts` (the bundle)
- `packages/features/src/server/agent/extension.ts` (extend `AgentPorts`)
- `packages/features/src/server/agent/bundles.ts` (one line)
- Every `AgentPorts` construction site found in Step 1 (likely
  `apps/desktop/src/main/lib/agent-lifecycle.ts` + the delegation path)
- `packages/features/src/server/agent/__tests__/` (bundle + schema tests)
- `plans/README.md`

**Out of scope**:

- Semantic/embedding search — this exposes the EXISTING lexical index only.
- Auto-attaching linked notes as chat context — separate feature; note it as
  follow-up.
- The graph view / `getLinkGraph` as a tool — start with the two
  high-signal tools; graph output is token-noise until proven needed.
- The inline-AI and ghost-text sessions — they run with restricted/no tools
  (`allowedToolNames`), and must NOT gain these tools implicitly. Verify.

## Git workflow

- Branch: `kyh/plan-013-agent-knowledge-tools`
- Commit: `feat(agent): search_vault + get_backlinks tools over the knowledge engine`

## Steps

### Step 1: Map the ports construction sites

`grep -rn "AgentPorts" packages apps` — list every site that BUILDS the
object (not just types). Read `browser/extension.ts` end-to-end for: bundle
shape (`name`, `register`, optional `setup`), how tools are declared
(schemas, descriptions, result shape — including how it returns text vs
image content), and how it accesses `ctx.ports`. If ports are built in more
than the expected two places, or the background agent does NOT receive
extension bundles at all (delegation may run a different tool surface),
record what you found — if the background agent can't get the port without
touching `main/`-boundary rules, scope the tools to the chat agent only and
say so in the PR.

### Step 2: Extend AgentPorts

In `extension.ts`, add:

```ts
/** Knowledge-engine access (derived indexes live OUTSIDE the vault, so the
 * agent's file tools can't reach them — hence a port). Read-only. */
export type KnowledgePort = {
  search(query: string, limit?: number): SearchHit[];
  backlinks(path: string): BacklinkHit[];
};
```

Use the ACTUAL return types of `getKnowledgeManager().search/backlinks`
(read `knowledge-manager.ts` for their signatures; import types from their
home — likely `@repo/core/knowledge/*` — not redefined). Add
`knowledge: KnowledgePort` to `AgentPorts`. Update every construction site:
`{ search: (q, l) => getKnowledgeManager().search(q, l), backlinks: (p) =>
getKnowledgeManager().backlinks(p) }` (from the features/server side the
manager is directly importable; from desktop main, follow how the executor
port is built there).

**Verify**: `pnpm typecheck` → exit 0 (every construction site now fails until updated — that's the seam working)

### Step 3: The bundle

`agent/knowledge/extension.ts`, default-exporting a `PiExtensionBundle`
named `knowledge` with two tools (match browser/extension.ts's declaration
style exactly):

- `search_vault` — params `Type.Object({ query: Type.String(...), limit:
Type.Optional(Type.Number(...)) })`; description: "Full-text search over
  the user's vault (lexical, ranked). Returns matching note paths with
  snippets. Prefer this over grep for finding notes by topic." Result: a
  compact text block, one line per hit: `path — snippet` (cap `limit` at 20
  default; hard-cap 50). Empty result → the string `No matches.` (a clear
  sentinel beats empty output for the model).
- `get_backlinks` — params `Type.Object({ path: Type.String(...) })`;
  description: "Notes that link TO the given vault-relative note path
  (wiki-links and markdown links)." Result: one path per line, or `No
backlinks.`

Tools are read-only: no confirmation gating (match however browser marks its
non-mutating tools). Register in `bundles.ts` (one import + one array entry —
the sort keeps order deterministic).

**Verify**: `pnpm --filter @repo/features test` → `bundles.test.ts` passes
(it enforces folder↔list agreement)

### Step 4: Tests

Model after existing agent tests (grep `__tests__` under `agent/`):

1. Bundle disk-drift: covered by the existing `bundles.test.ts` (confirm).
2. Schema validity: `validateToolParametersSchema` accepts both tools'
   schemas (find how existing tests invoke it).
3. Tool behavior against a fake `KnowledgePort`: hit formatting, the
   `No matches.` sentinel, limit capping.

**Verify**: `pnpm --filter @repo/features test` → pass

### Step 5: Live verification

`pnpm dev:desktop` (needs pi login): ask the chat agent "search my vault for
<a topic that exists in your test vault> and tell me which notes link to the
top hit." Confirm in the chat stream it called `search_vault` then
`get_backlinks` (tool cards render in the composer). If this machine has no
pi login, state that in the PR and mark this check operator-pending.

### Step 6: Gates

`pnpm format:fix` then the full canonical gate.

## Done criteria

- [ ] `AgentPorts.knowledge` exists; all construction sites supply it
- [ ] `search_vault` / `get_backlinks` registered via the `knowledge` bundle; bundles test green
- [ ] Schemas pass `validateToolParametersSchema`; tool unit tests pass
- [ ] Inline-AI/ghost-text sessions unchanged (their `allowedToolNames` gate verified)
- [ ] Full gate exits 0; `plans/README.md` updated

## STOP conditions

- The bundle/ports pattern differs materially from the excerpts (drift).
- Step 1 shows the background (delegation) agent's ports can't be extended
  without violating the `agent/` → `main/` boundary — scope to chat agent,
  note it, continue.
- `search`/`backlinks` signatures on `KnowledgeManager` don't match the
  handler usage shown above.

## Maintenance notes

- Natural follow-ups (deferred): auto-attach the open note's forward links as
  context; a `list_wiki_targets` tool for link-suggesting flows; semantic
  search when/if embeddings land.
- Reviewer: tool DESCRIPTIONS are prompt engineering — review them as copy
  (they steer when the model reaches for grep vs. search).
- Token hygiene: snippets are the cost center; keep the per-hit snippet short
  (the search index already produces bounded snippets — verify).
