# @repo/notes

The pure, platform-neutral domain core: the knowledge engine
(links/tags/search/tasks) over one markdown scan.

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
    task-ordinal.ts    # what an ordinal names: the ONE count of a doc's
                       # checkboxes, extracted with the bytes of each line
    source-lines.ts    # what a LINE is — content excludes its terminator —
                       # as a split and as a span, so a guarded splice leaves
                       # every other byte, CRLF included, untouched
    vault-search.ts    # the text ∧ tag composition, shared VERBATIM by the
                       # command palette and the agent's search_vault
    tag-index.ts, related-notes.ts, note-name.ts, doc-file.ts,
    vault-path.ts      # tags, related-notes scorer, name validation, doc
                       # test, posix path helpers
  markdown/            # the one scan, and what reads a doc's header
    scan-parse.ts      # the grammar every knowledge scan reads; TOTAL, and
                       # disabling codeIndented/htmlFlow is what keeps its task
                       # count equal to the set the editor draws
    remark-wiki-link.ts  # own [[wiki-link]] tokenizer, byte-exact both ways
    frontmatter.ts     # split/recombine + the typed-property ADT (YAML it
                       # cannot represent is preserved byte-exactly)
    thread-marker.ts, thread-anchor.ts  # the delegation marker: parsed as a
                       # block-level node, never matched as text
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
- **One parse per doc** (`projectDoc`), over one grammar (`scan-parse.ts`), so
  no two answers about a document can drift apart.
- **There is no crawl to exclude anything from.** This package sees a document
  and its content, never a directory. Per-vault hiding is a VIEW filter a
  consumer applies over the listing.

## Seams

- `SqlDriver` (`knowledge/sql-knowledge-store.ts`): the host binds it —
  better-sqlite3 in `apps/cli/src/server/knowledge/sqlite-driver.ts`.

## Testing

`pnpm --filter @repo/notes test` — vitest. `src/__tests__/` pins the
knowledge engine: resolver tiers (including an oracle equivalence for the
basename buckets), rename byte surgery, guarded edits, daily-path round-trips.
