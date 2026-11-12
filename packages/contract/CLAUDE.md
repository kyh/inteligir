# Decisions: @repo/contract

`/v1`'s one wire, and the library model both ends of it validate against. Every
client and the Worker compile against it, so it is zod and oRPC's contract
with no node or react import (`oxlint.config.ts`) and no workspace dependency
in its manifest, and the model's modules take no `crypto` or `URL` global: the
clock, random bytes and fresh ids are injected.

## The library model

- **The persisted node set is spelled here, below the editor, and it is
  strict.** The phone's native end types an item's blocks by it and loads no
  Plate; an item link is Plate's own mention, its `key` the item's id.
  `packages/contract/src/library/library-nodes.ts`.
- **An item is fields and blocks, and everything else is derived in the same
  transaction.** A frontmatter block would be a second spelling of its columns,
  and each field's cap keeps the largest row inside a Durable Object's 2 MB.
  `packages/contract/src/library/derive-item.ts`.
- **A field is guarded by its value, and a body is no op.** A body is its note's
  live document, so block ops beside it would be two writers of one body.
  `packages/contract/src/library/field-ops.ts`.
- **A folder's place is a fractional key.** An integer position renumbers on
  insert, and two renumberings conflict. `packages/contract/src/library/order-key.ts`.
- **The listing is in memory over what it filters and orders by, and pinned
  leads it.** One assembly answers for the cell and the fake cell alike, and a
  host hands a batch's rows whole. `packages/contract/src/library/library-index.ts`.
- **One fake cell answers every client's suites, over the cell's own folder and
  organize rules.** A fake per client, or rules spelled twice, drift from what
  the cell refuses. `packages/contract/src/library/cell-rules.ts`.
- **An item's reading is one value, which every writer moves and every surface
  reads alike.** Three fields set by hand badged a failure over a read.
  `packages/contract/src/library/item-reading.ts`.

## Items and files

- **A url has one key, computed without the platform's URL.** React Native's
  `URL` is not WHATWG, so the phone and the Mac would disagree.
  `packages/contract/src/items/item-url.ts`.
- **No reader decides what a doc is on its own.** A private `.md` rule leaves
  out every `.txt` note and disagrees on a name's case.
  `packages/contract/src/knowledge/doc-file.ts`.
- **An import takes off a sole top folder only when it holds `assets/`.** An
  Obsidian vault's top folder is one the person named.
  `packages/editor/src/codec/import-plan.ts`.
