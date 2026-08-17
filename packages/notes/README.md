# @repo/notes

The pure, platform-neutral domain core: the knowledge engine
(links/tags/search/tasks) and the markdown parse pipeline.

## Why it exists

This is the sharing seam. ZERO node/react imports — lint-
(`.oxlintrc.json` `no-restricted-imports`) and tsconfig-enforced (`lib:
["ES2023", "WebWorker"]`, `types: []`) — so the same code runs unchanged on a
server, in a browser and in React Native. Platforms inject capabilities (SQL
driver, clock). Everything above it depends on it; it depends on nothing in the
workspace.

## Layout

```
src/
  daily-path.ts        # pure date↔path math for daily notes, both directions
                       # in ONE module so the UI and the capture drain agree
  knowledge/           # derived-index engine
    projection.ts      # projectDoc — the ONE parse per doc (PROJECTION_VERSION)
    link-graph-index.ts  # pure link/tag/title/graph resolution, fed projections
    link-extract.ts, link-resolve.ts, rename-links.ts  # scan → 5-tier
                       # resolution (aliases last) → byte-surgical rename
    knowledge-store.ts, sql-knowledge-store.ts  # persistence port (types
                       # only) + schema/FTS5-bm25 written once over SqlDriver
    knowledge-index.ts, search-index.ts  # zero-dep reference composition +
                       # in-memory tiered lexical index (behavior pin)
    task-ordinal.ts    # what (sourceFile, ordinal) names: the ONE count of a
                       # doc's checkboxes, the lookup, the two state rules
                       # (delegation wants an open one, a toggle takes either)
                       # and the guarded write back
    source-lines.ts    # what a LINE is — content excludes its terminator —
                       # as a split and as a span, so a guarded splice leaves
                       # every other byte, CRLF included, untouched
    vault-search.ts    # the text ∧ tag composition, shared VERBATIM by the
                       # command palette and the agent's search_vault
    task-schedule.ts, tag-index.ts, related-notes.ts, note-name.ts,
    doc-file.ts, vault-path.ts  # task-date association, tags, related-notes
                       # scorer, name validation, doc test, posix path helpers
  markdown/            # the remark pipeline
    parse.ts, md-plugins.ts  # owned unified parse + probe-proven plugin order
    scan-parse.ts      # the grammar the knowledge scans read: the editor's
                       # flavor on the two constructs that move a task ordinal
    remark-opaque.ts   # post-parse transform: a construct the editor has no
                       # node for becomes an opaque node holding its own
                       # markdown, so the file opens instead of being refused
    remark-wiki-link.ts, remark-mdx-agnostic.ts  # own wiki-link tokenizer
                       # (byte-exact round-trip); MDX without acorn, sharing
                       # `<` with CommonMark behind a crash-free lookahead
    frontmatter.ts     # split/recombine + typed properties + the ONE privacy
                       # kernel (privacyOfParsed answers indeterminate for
                       # frontmatter it can't type; AI callers fail closed)
```

## Invariants

- **Purity is the law.** No I/O, clock, or crypto anywhere; callers supply
  the driver and the timestamps.
- **The knowledge index is a wipe-and-rebuild cache** (repo Decisions).
  Nothing durable may ever live in it; it is rebuilt from the vault.
- **Frontmatter is the ONLY property store** (repo Decisions). YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **Refusals are values.** A guarded line edit refuses (a VALUE) on any byte
  drift — never a silent wrong write.
- **One parse per doc** (`projectDoc`); link extraction reuses the editor's
  own remark-wiki-link tokenizer, so index and editor never disagree.
- **There is no crawl to exclude anything from.** The host is the only writer
  of its own manifest, so this package sees a document and its hash, never a
  directory. Per-vault or per-user hiding is a VIEW filter a consumer applies
  over the listing.

## Seams

- `SqlDriver` (`knowledge/sql-knowledge-store.ts`): the host binds the Durable
  Object's own SQLite in `apps/web/src/worker/host/knowledge/do-sql-driver.ts`;
  the fixture Bridge binds SQLite wasm.
- `task-schedule.ts`: injected daily-note config and a `todayIso` clock.

## Testing

`pnpm --filter @repo/notes test` — vitest. `src/__tests__/` pins the
knowledge engine: resolver tiers, rename byte surgery, guarded edits,
daily-path round-trips, a perf oracle.
