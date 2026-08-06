# @repo/notes

The pure, platform-neutral domain core: vault-sync protocol + engine, the
knowledge engine (links/tags/search/tasks), and the markdown parse pipeline.

## Why it exists

This is the sharing seam. ZERO node/electron/react/workspace imports — lint-
(`.oxlintrc.json` `no-restricted-imports`) and tsconfig-enforced (`lib:
["ES2023", "WebWorker"]`, `types: []`) — so the same code runs unchanged in
the Cloudflare Worker (apps/web), React Native (apps/mobile), and the
desktop renderer. Platforms inject capabilities (hasher, IO, clock).
Everything above it (bridge, vault, sync, server, agent, all three apps)
depends on it; it depends on nothing in the workspace.

## Layout

```
src/
  daily-path.ts        # pure date↔path math for daily notes, both directions
                       # in ONE module so desktop/capture-drain/mobile agree
  sync/                # vault-sync protocol + engine
    vault-file.ts, manifest.ts, plan.ts  # atoms: sha-256 file identity,
                       # coordinator/local manifests, typed SyncPlan ops
    reconcile.ts       # the PURE 3-way last-write-wins + conflict-copy brain
    merge/             # mergeLadder: whitespace → diff3 → frontmatter →
                       # append-union rungs before a conflict-copy sibling
    engine.ts          # SyncEngine — runs plans over injected ports (Seams)
    sync-port.ts, wire.ts, http-sync-port.ts  # transport contract: pure HTTP
                       # route shapes + the universal fetch client
    base-store.ts, blob-store.ts  # persistence ports: last-synced BASE
                       # anchor + base BYTES shadow (the true 3-way base)
    status.ts, guards.ts  # UI-facing pass lifecycle; isRecord guard
  knowledge/           # derived-index engine
    projection.ts      # projectDoc — the ONE parse per doc (PROJECTION_VERSION)
    link-graph-index.ts  # pure link/tag/title/graph resolution, fed projections
    link-extract.ts, link-resolve.ts, rename-links.ts  # scan → 5-tier
                       # resolution (aliases last) → byte-surgical rename
    knowledge-store.ts, sql-knowledge-store.ts  # persistence port (types
                       # only) + schema/FTS5-bm25 written once over SqlDriver
    knowledge-index.ts, search-index.ts  # zero-dep reference composition +
                       # in-memory tiered lexical index (behavior pin)
    guarded-line-edit.ts # raw-byte-guarded line splice (task toggles)
    task-schedule.ts, tag-index.ts, related-notes.ts, note-name.ts,
    doc-file.ts, vault-path.ts  # task-date association, tags, related-notes
                       # scorer, name validation, doc test, posix path helpers
  markdown/            # the remark pipeline
    parse.ts, md-plugins.ts  # owned unified parse + probe-proven plugin order
    vocabulary.ts      # post-parse gate: outside the fixed vocabulary → Raw
    remark-wiki-link.ts, remark-mdx-agnostic.ts  # own wiki-link tokenizer
                       # (byte-exact round-trip); MDX without acorn
    frontmatter.ts     # split/recombine + typed properties + notePrivacy
                       # (unparseable frontmatter counts as private)
```

## Invariants

- **Purity is the law.** No I/O, clock, or crypto anywhere; callers supply
  hashes and timestamps. Even `URL` is avoided in wire.ts (dom-lib types).
- **The knowledge index is a wipe-and-rebuild cache** (repo Decisions).
  Nothing durable may ever live in it; per-device, NEVER synced. Sync lists
  vault FILES only, so derived state can't leak into the protocol.
- **Frontmatter is the ONLY property store** (repo Decisions). YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **Conflicts are values.** A version conflict is a typed `{ok:false}` result
  (HTTP-200 on the wire), never a throw. The merge ladder may never lose a
  content line; the terminal answer is a conflict-copy sibling. Guarded line
  edits refuse (a VALUE) on any byte drift — never a silent wrong write.
- **One parse per doc** (`projectDoc`); link extraction reuses the editor's
  own remark-wiki-link tokenizer, so index and editor never disagree.

## Seams

- `SyncEngine` ports (`sync/engine.ts`): `io`/`port`/`base`/`blobs`/`hash`/
  `stamp`. Desktop binds node crypto + VaultManager + JsonStores in
  `packages/sync/src/sync-manager.ts`; mobile binds expo-crypto/-file-system
  in `apps/mobile/src/lib/sync/manager.ts`. Same engine, thin adapters.
- `SqlDriver` (`knowledge/sql-knowledge-store.ts`): desktop binds node:sqlite
  in `packages/server/src/knowledge/sqlite-knowledge-store.ts`; the dev
  harness binds SQLite wasm.
- `HttpSyncPort`: injectable `fetch`; `task-schedule.ts`: injected daily-note
  config and a `todayIso` clock.

## Testing

`pnpm --filter @repo/notes test` — vitest. `sync/__tests__/` pins
reconcile/engine/ladder semantics and the wire contract against fake
`Response`s (`in-memory-sync-port.ts` is exported for other packages'
tests). `src/__tests__/` pins the knowledge engine: resolver tiers, rename
byte surgery, guarded edits, daily-path round-trips, a perf oracle.
