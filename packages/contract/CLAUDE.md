# Decisions: @repo/contract

`/v1`'s one wire, and the library model both ends of it validate against. Every
client and the Worker compile against it, so it is zod and oRPC's contract
with no node or react import (`oxlint.config.ts`) and no workspace dependency
in its manifest, and the model's modules take no `crypto` global: the clock,
random bytes and fresh ids are injected.

## The library model

- **The persisted node set is spelled here, below the editor, and it is
  strict.** The phone's native end types an item's blocks by it and loads no
  Plate; an item link is Plate's own mention, its `key` the item's id.
  `packages/contract/src/library/library-nodes.ts`.
- **An item is fields and blocks, and everything else is derived in the same
  transaction.** A frontmatter block would be a second spelling of its columns,
  and each field's cap keeps the largest row inside a Durable Object's 2 MB.
  `packages/contract/src/library/derive-item.ts`.
- **A base guards only what a device computed away from the cell, a property's
  op, and a body is no op.** A verb of the cell's reads the fields it changes in
  the transaction that lands them, where a base cannot fail, and a body is its
  note's live document. `packages/contract/src/library/field-ops.ts`.
- **`/v1`'s write takes a property's op alone.** Every other field moves by a
  verb of the cell's, which asks the reading or tells the note with it.
  `packages/contract/src/library/library-contract.ts`.
- **A conflict is a code and a sentence.** A screen that meets one puts back
  what it showed and reads again, so a payload to merge against has no reader.
  `packages/contract/src/v1-errors.ts`.
- **A folder's place is a fractional key.** An integer position renumbers on
  insert, and two renumberings conflict. `packages/contract/src/library/order-key.ts`.
- **The listing is in memory over what it filters and orders by, and pinned
  leads it.** One assembly answers the apps and an agent, for the cell and the
  fake cell alike, and a host hands a batch's rows whole.
  `packages/contract/src/library/library-index.ts`.
- **A listing page asks by the scope union, and its order is a sort or a
  search's ranks.** A bag of flags lets Deleted take a folder and relevance go
  without words, and each device then flattens the scope its own way.
  `packages/contract/src/library/library-wire.ts`.
- **A row's input is whole once its schema parsed it: a default and a page's
  place are the schema's.** A default the cell supplies is a parse a new row
  forgets, and a cursor read past the schema needs a refusal of its own.
  `packages/contract/src/library/library-contract.ts`.
- **One fake cell answers every client's suites, over the cell's own rules and
  held to it by the cases both run.** A fake per client, a rule spelled twice or
  a case copied by hand drifts from what the cell answers.
  `packages/contract/src/test-support/cell-conformance.ts`.
- **An item's reading is one field, a union the row and the wire hold as it
  is, and every writer moves it by one function.** Three fields paired by hand
  can badge a failure over a read. `packages/contract/src/library/item-reading.ts`.
- **A saved link nobody named holds an empty title, and its card goes by its
  address.** A made-up name in the person's field has to be made up again to
  ask whether a page may still name the link.
  `packages/contract/src/library/derive-item.ts`.
- **A make's fields are spelled once, and an import's item is a make less its
  place.** An item spelled by hand at each landing reads one way on the device
  that drew it and another once the cell answers.
  `packages/contract/src/library/item-makes.ts`.
- **A library tool has one name, in a plain table the connector's rows, the
  agent's policies and each device's words are typed against.** A name spelled
  in each package lets a rename compile and draw as "Used the library".
  `packages/contract/src/library/agent-tools.ts`.
- **A sweep names its items by their scope, in a row no tool carries** (owner
  decision). A device reads a scope a page at a time, so no list of ids it
  holds is all of it, and an agent's approval counts a delete from the ids its
  call names. `packages/contract/src/library/library-contract.ts`.

## Items and files

- **A url is read by the platform's `URL`, and its key is the cell's.** Expo's
  `URL` keeps an IDN host as written, so a device only tests an address and
  compares its own spellings. `packages/contract/src/items/item-url.ts`.
- **A device keeps a reading only for its article; the fill, the last reader, keeps a page that
  named itself.** An item saved read is never filled, so a device hands the fill what it could not
  read, and nothing reads after the fill. `packages/contract/src/items/link-fill.ts`.
- **A picture's type is `sniffMedia`'s list and its size a bounded header read, a HEIF's by
  image-size's one handler over the file's head.** That library's detector takes twenty formats and
  a page holding an `<svg>` for a picture, and its handlers walk hostile bytes without a bound.
  `packages/contract/src/items/sniff-media.ts`.
- **No reader decides what a doc is on its own.** A private `.md` rule leaves
  out every `.txt` note and disagrees on a name's case.
  `packages/contract/src/knowledge/doc-file.ts`.
