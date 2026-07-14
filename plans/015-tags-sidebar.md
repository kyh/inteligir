# Plan 015: Promote tags into a persistent sidebar section and clickable editor chips

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/desktop/src/renderer/sidebar apps/desktop/src/renderer/command/command-palette.tsx`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

Tags are fully built on the backend — a case-unified tag index in `@repo/core/knowledge`, a `tags()` count query, a `notesWithTag()` lookup, and even an agent-side tag filter — but the only user-facing surface is a transient command-palette mode (`#` → tag list → notes). A user browsing by topic has no persistent affordance, and inline `#tags` in a note render as plain text, not as something you can click. This plan spends UI-only effort on an index that already exists: a Tags section in the sidebar, and `#tag` chips in the editor that open the tag's note list. It's the cheapest Obsidian-parity surface available.

## Current state

- The palette already does the whole flow — `apps/desktop/src/renderer/command/command-palette.tsx:318-340` renders the tag list with counts and navigates to a tag view:

```tsx
<CommandGroup heading="Tags">
  {matches.map((t) => (
    <CommandItem
      key={t.tag}
      value={`#${t.tag}`}
      onSelect={() => goto({ kind: "browseTag", tag: t.tag })}
    >
      <HashIcon />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="truncate">{t.tag}</span>
        <span className="text-xs text-muted-foreground">{t.count}</span>
      </span>
    </CommandItem>
  ))}
</CommandGroup>
```

So `browseTag` navigation, the tag→notes view, and the tag-count query are ALL built. Read this file first and reuse its data path — do not build a second one.

- `packages/features/src/server/knowledge/knowledge-manager.ts:79-87` — the host queries:

```ts
tags(): TagCount[] {
  this.ensureBuilt();
  return this.index.tags();
}

notesWithTag(tag: string): string[] {
  this.ensureBuilt();
  return this.index.notesWithTag(tag);
}
```

- `apps/desktop/src/renderer/sidebar/app-sidebar.tsx:184-251` — the sidebar's structure: `<SidebarContent className="px-2">` holds `<SidebarGroup>`s; there's a "Notes" group with a `<SidebarGroupLabel>` at ~line 204. The new Tags group follows the SAME shadcn sidebar primitives (Base UI + Tailwind, from `@repo/ui`). Read the file and match its idiom exactly — do not introduce a new styling approach.
- Whether tags reach the renderer over an existing Bridge channel: **check first.** `grep -rn "tags\|notesWithTag" packages/features/src/ipc-registry.ts`. If the palette already gets tags over a channel, reuse it. If it doesn't (it must — the palette renders counts), find how and copy that path. **Only if a channel is genuinely missing** do you add one, and then it's the full three-step ritual: registry entry in `packages/features/src/ipc-registry.ts` (TypeBox payload + result type) → host handler in `packages/features/src/server/handlers/` → fixture implementation in `apps/desktop/dev/fixture-bridge.ts` (typed `: Bridge`; typecheck FAILS until it's covered). This triple is deliberate and typecheck-enforced — no codegen.
- Editor chips: inline `#tags` are part of the markdown vocabulary and already parsed by the core tag index. Rendering them as chips is a Plate **decoration/leaf** concern in `apps/desktop/src/renderer/editor/` — it must NOT change the file's bytes. The byte-stability invariant (`roundTrip(raw) === raw`) is the thing UI changes most often break; the byte-pinned fixtures under `apps/desktop/src/renderer/__tests__/fixtures/` must stay byte-identical and must never be hand-edited or formatted.

## Commands you will need

| Purpose       | Command                                                                              | Expected                                       |
| ------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Format        | `pnpm format:fix` (FIRST)                                                            | exit 0                                         |
| Typecheck     | `pnpm typecheck`                                                                     | exit 0                                         |
| Desktop tests | `pnpm --filter @repo/desktop test`                                                   | all pass (round-trip matrix included)          |
| Dev harness   | `pnpm --filter @repo/desktop dev:harness`                                            | vite on :5173, real UI over the fixture Bridge |
| Full gates    | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0                                         |

## Suggested executor toolkit

- The `agent-browser` skill to drive the dev harness at `http://localhost:5173` — REQUIRED for the verification step; a UI change is not done until it's been driven.

## Scope

**In scope**:

- `apps/desktop/src/renderer/sidebar/app-sidebar.tsx` — the Tags group
- A new sidebar tags component if the group grows past ~40 lines (kebab-case, e.g. `sidebar/tags-section.tsx`)
- The editor tag-chip decoration under `apps/desktop/src/renderer/editor/` (leaf/decoration only)
- `apps/desktop/dev/fixture-bridge.ts` — ONLY if a new Bridge channel proves necessary
- Tests

**Out of scope**:

- `packages/core/knowledge/**` — the tag index is correct and case-unification is settled; do not touch it.
- The markdown pipeline / `md-rules.ts` / vocabulary — chips are a RENDER concern; the bytes of `#tag` must not change.
- The command palette's tag mode — it stays; the sidebar is an additional surface, not a replacement.
- Frontmatter tag editing UI — separate concern (File Properties owns frontmatter).
- Any change to the byte-pinned fixtures.

## Git workflow

- Branch: `kyh/plan-015-tags-sidebar`
- Conventional commits, e.g. `feat(desktop): tags sidebar section` / `feat(editor): clickable inline tag chips`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Find the existing tag data path

`grep -rn "browseTag\|tags()" apps/desktop/src/renderer packages/features/src/ipc-registry.ts` and read how the palette gets `TagCount[]` into the renderer. Write down the channel/hook it uses — you will reuse it verbatim.

**Verify**: you can name the exact Bridge channel or hook the palette uses. If none exists (the palette computes tags some other way), STOP and report what you found before adding a channel.

### Step 2: Tags section in the sidebar

Add a collapsible `<SidebarGroup>` labeled "Tags" below the existing Notes group in `app-sidebar.tsx`, listing tags with their counts (same shape as the palette: name left, count right, `HashIcon`). Selecting a tag opens the same tag→notes view the palette's `goto({kind:"browseTag", tag})` opens — reuse that navigation, don't re-implement it. Match the sidebar's existing row idiom (full-width rows, roving-tabindex keyboard nav — see `sidebar/tree-navigation.ts`; if the tag list needs keyboard nav, follow that module's pattern rather than inventing one). Empty vault / no tags → render nothing or a muted empty state consistent with the rest of the sidebar.

**Verify**: `pnpm typecheck` → exit 0. Dev harness: the Tags group renders with the fixture vault's tags and counts.

### Step 3: Inline tag chips in the editor

Add a Plate decoration/leaf that renders inline `#tag` occurrences as chips (subtle, matching the shadcn token vocabulary — muted background, no custom colors) and makes them clickable → opens that tag's note list (same navigation as Step 2). This is presentation only.

**CRITICAL**: the document's bytes must not change. After implementing, run the round-trip suite — if any fixture's bytes change, you have broken the invariant: revert and reconsider (a decoration must never serialize).

**Verify**: `pnpm --filter @repo/desktop test` → the round-trip matrix, adversarial harness, and kit-parity tests ALL pass, with zero fixture-byte changes (`git diff --stat apps/desktop/src/renderer/__tests__/fixtures/` → empty).

### Step 4: Drive it

Run the dev harness and exercise: sidebar Tags group lists tags; clicking one lists its notes; opening a note shows `#tag` chips; clicking a chip navigates to that tag; toggling the editor to Raw mode shows the ORIGINAL `#tag` text unchanged.

**Verify**: all five behaviors observed in the running app (use `agent-browser`). Report what you saw.

### Step 5: Gates

`pnpm format:fix`, then full gates.

**Verify**: exit 0.

## Test plan

- Sidebar: if a mounted-component harness exists for sidebar pieces (check `apps/desktop/src/__tests__/` — there are only a handful of `.tsx` tests repo-wide), add one asserting tags render with counts. If no harness exists, do NOT build one for this plan — rely on the dev-harness verification in Step 4 and say so honestly in your report.
- Editor chips: the load-bearing test is byte-stability — the existing round-trip suite covers it, and its passing IS the assertion. Add a decoration-level unit test only if the chip logic (which spans in a text node get decorated) is non-trivial enough to unit-test in isolation.

## Done criteria

- [ ] Tags group renders in the sidebar with counts, sourced from the EXISTING tag index/channel (no duplicate data path)
- [ ] Clicking a tag (sidebar or chip) opens the tag's note list
- [ ] `git diff --stat apps/desktop/src/renderer/__tests__/fixtures/` → empty (zero fixture byte changes)
- [ ] `pnpm --filter @repo/desktop test` green (round-trip + kit parity)
- [ ] Step 4's five behaviors verified in the running harness and reported
- [ ] Full gates green; `plans/README.md` updated

## STOP conditions

- No Bridge channel exposes tags to the renderer (contradicts the palette rendering counts) — report what the palette actually does before adding a channel.
- The chip decoration changes any fixture's bytes — revert immediately; a serializing decoration is a corruption bug, not a styling bug.
- The tag→notes view (`browseTag`) turns out to be palette-internal and not reachable as a standalone view — report; wiring a new view surface is a bigger design call than this plan covers.
- Keyboard navigation in the sidebar breaks (roving tabindex) — the tree nav is tested; if your group interferes, report rather than loosening the nav.

## Maintenance notes

- Tag case-unification lives in the core tag index; the UI must never re-case tags itself (`#Foo` and `#foo` are one tag by design).
- If frontmatter tag editing ever lands, the sidebar section should keep sourcing from the index (which already merges inline + frontmatter tags) rather than reading frontmatter directly.
- Reviewer: scrutinize the decoration for any path where it could write to the document. Decorations are render-only — a `setNodes` call anywhere near this code is a bug.
- Deferred: tag rename/merge across the vault (that's byte-surgery like the wiki-link rename, and belongs with that machinery — not here).
