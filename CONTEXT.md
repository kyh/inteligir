# CONTEXT.md — the domain glossary

What the words mean. The decision files (`AGENTS.md` § Decisions) record **why
a choice was made**; this records **what a term names**, where it lives, and
— the part worth reading — the neighbouring concept it gets confused with.

Rules for this file: every entry points at the module that OWNS the concept
rather than restating its implementation, because the module's own header is the
detail and this is the map. An entry that cannot be checked against code does
not belong here.

---

## The library in the cloud

One library cell per account, a replica on every device, and the agents that
reach it.

**library cell** — one account's whole library: a SQLite Durable Object,
`LibraryDO`, in the Worker (`apps/web/src/worker/library/library-do.ts`), named
`library:<userId>` only from a verified credential, or from what the cell itself
gave out: a fill message or a conversation's name. It holds the items,
their **blocks**, folders, tags, links, highlights, threads, the change log,
History and the account's live sockets, and it is the library's only writer: every `/v1` library call and every **connector** call
is forwarded to it. R2 holds the bytes it names by hash, and D1 only the
accounts. Not a **replica**, which a device reads while it writes through the
cell.

**principal** — who a library call is by, as the Worker verified it: the
account and the actor whose **change set** its writes join (a device, the
site's own tab on its session, or a **connected assistant** under one grant,
the only actor with scopes). The Worker
stamps it on the call it forwards to the **library cell** and drops any copy the
request brought (`apps/web/src/worker/library/library-principal.ts`). Not a
credential: the cell never sees one.

**change set** — the unit of History and of undo. Every write lands in one,
which records each item it touched before and after, its actor (the person,
the agent, an assistant, an import, a fill or an undo) and when it opened and
sealed. A device's typing seals after 15 s of quiet or 60 s in all;
a **turn** is one set; a **connected assistant**'s writes are one set per
grant, sealed after 10 idle minutes. Undo reverts sets three-way, newest
first, and keeps every later edit; an undo is a set of its own. The cell keeps
them (`apps/web/src/worker/library/change-sets.ts`), and the revert is
`@repo/notes/library/revert-change`'s.

**block** — one top-level node of an item's body, a Plate element stored as a
row of its own: its id, its fractional order key, its **section**, its JSON
and its hash. A write names the hash it was computed from, so writes to two
blocks never meet, and one whose base moved is answered `CONFLICT` with the
block as it is. A list item is a block, since lists are flat indent lists. Not
a Plate node at any depth: a block's children are inside its JSON. The model is
`@repo/notes/library/block-ops`, its vocabulary
`@repo/notes/library/library-nodes`, the ids the editor's
(`packages/editor/src/item/item-session.ts`).

**section** — which part of an item a **block** belongs to: `note`, what the
person wrote, or `article`, the page's readable text a fill wrote. A fill and
Refresh replace only `article` blocks, so reading a page again never touches
the person's writing. An item reads its note before its article
(`@repo/notes/library/block-order`), and its markdown writes the article as
one top-level `:::article` container after the note
(`@repo/editor/codec/item-markdown`).
Not a heading's stretch of a note (its outline), and not a folder.

**replica** — a device's copy of the synced tables, every item, block, folder,
tag, link, highlight, thread and thread event, in SQLite on the device: in Rust
on the Mac (`apps/desktop/src-tauri/src/replica.rs`), in expo-sqlite on the
phone (`apps/mobile/src/lib/expo-replica-sql.ts`), in memory in the browser tab
(`apps/workspace/src/app/cloud/page-library.ts`). It pulls the cell's change log by cursor, every
screen reads it, and search runs on its own full-text index, online too, so
there is one ranking. The socket's ping only says to pull; nothing correct
rests on it. The engine is `@repo/library-replica`
(`packages/library-replica/src/library-replica.ts`): its pull lays a row only
over an older one (`replica-pull.ts`, `replica-rows.ts`), and a screen reads
each item with the **outbox** laid over (`replica-listing.ts`). Not the
**library cell**, the only writer, and not a cache: only file bytes are ever
evicted.

**outbox** — a **replica**'s queued writes
(`packages/library-replica/src/outbox.ts`). Each is written in the replica's
own transaction, so the screen shows it at once, then sent oldest first with
an op id the cell answers once, so a resend after a lost answer is the same
write; a later write to an item joins its row while it waits
(`outbox-ops.ts`). A `CONFLICT` settles through the block merge and goes
again (`outbox-settle.ts`); a refusal no resend passes is **parked** for the
person. Not the browser extension's
retry queue, which holds a save's url, title and selection and writes nothing
until the save lands.

**connector** — the library as a remote MCP server: `/connector` on the Worker
(`apps/web/src/worker/connector/connector-route.ts`), the library's procedures
tagged as tools
(`apps/web/src/worker/connector/library-tools.ts`) and served in the account's
cell (`connector-server.ts`), behind OAuth from
`@cloudflare/workers-oauth-provider` (`connector-auth.ts`) with a
read-and-change scope, `library`, and a read-only one, `library:read`. Every
**connected assistant** calls it. `/v1` serves the same procedures, of which
the apps call only a few, and the **built-in agent**'s cell runs them for it
with no connector between. Connector is Claude's word for it and the
product's, which never says MCP.

**connected assistant** — the person's own Claude (claude.ai, Claude Desktop,
Claude Code) or ChatGPT, signed in to the **connector** by OAuth on our
consent page (`apps/web/src/worker/connector/consent-route.ts`); its model
runs on its own plan, never ours. Each one is a grant on the account, which
`account.assistants` lists and revokes (`assistant-grants.ts`), and Settings ›
Account shows. Not the **built-in agent**, though both call the same tools.

**built-in agent** — the app's own agent: our loop over Claude, a Durable
Object for each **thread** (`apps/web/src/worker/agent/agent-thread.ts`),
calling Claude through AI Gateway. It changes the library only through the
account's cell, by the procedures the **connector** serves, run as the
agent's; it has no shell, files or web of its own, deleting and saving a link
are the calls that ask the person first, and it runs on our bill, within the
account's allowance. Not a **connected assistant**.

**turn** — one message to the **built-in agent** and the work it does until
Claude ends it, the person stops it, or the allowance does; waiting on an
approval does not end it. The cell checks the allowance before it starts and
reserves each model call before it is sent, and its writes are one **change
set**, which "Undo this turn" reverts. A send while its thread's turn runs
waits its turn (`apps/web/src/worker/agent/agent-turns.ts`). Not a connected
assistant's call, which is no turn.

**thread** — a conversation with the **built-in agent**, the account's, so
every device shows it: its transcript in its own object and its events synced
as rows (`agent-turns.ts`).

## The library

**doc** — a file whose extension is editable text: `.md`, `.markdown`, `.mdx`,
`.txt` (`@repo/notes/knowledge/doc-file`, the single source of that answer).
"Doc" is a CLASSIFICATION, not a shape: it decides which file of an imported
zip becomes a note. It is deliberately WIDER than what an export writes, every
note as `.md`, and WIDER than what a link may leave off: `.md` alone, so a
`.txt` note links as `[[todo.txt]]`.

**note** — an item of kind `note`, the text a person writes. An imported doc
whose `kind:` is missing or unknown is one, its filename its title, with no
slug layer.
The name an export files an item under follows one rule,
`@repo/notes/items/item-name`, whatever its kind: a title is repaired into a
name every disk takes, never refused, and its `[` and `]`, which would end a
link to it, become `(` and `)`.

**line** — a line's content EXCLUDES its terminator, whichever flavor (`\r\n`,
`\r`, `\n`), stated once in `@repo/notes`' `text/source-lines`. A second reading
of "what a line is" anywhere else is a file-corruption bug waiting to happen;
the line diff's LF-only split (`text/line-diff`) is the one deliberate
exception, because diff3 joins its segments back into the text's own bytes.
Not a write unit: a block is, guarded by its hash.

**annotation** — a highlighted passage of an item and an optional note on it,
with replies under it: markers `%%i:<ids>:start%%…%%i:<ids>:end%%` around the
passage in the item's blocks, and one entry per id among the item's rows in its
library's `annotations` table (`@repo/notes/annotations/store-schema`; folded
against the markers by `@repo/notes/annotations/annotation-threads`). A root whose `text` is `""` is a
bare highlight. Not an html or code comment, which the dialect keeps as the
note's own bytes, and not a task: it has no resolved state, and stays until it
is removed. A root whose quote the item's text does not hold is listed
**unplaced** under its item, and a fill that brings the page's text places it
again; the state is derived per answer, never stored
(`highlightSchema` in `@repo/contract/cloud/library/library-wire`).

**quote vs passage** — two texts of one highlight. The **quote** is what the
root recorded when it was made, the plain text clipped by `clipQuote`
(`@repo/notes/annotations/store-schema`), and it never changes: a card shows
it, the phone shows it, and a waiting highlight is placed by it. The
**passage** is the text between its markers in the item as it reads now
(`@repo/notes/annotations/passage-text`), `null` while unplaced; an edit inside the highlight changes the passage and leaves the
quote.

## Items

**library** — everything a person saved and wrote, their account's: one
library cell in the cloud (`LibraryDO`, `apps/web/src/worker/library/`), which
every device they sign in on holds a replica of (`@repo/library-replica`).

**item** — one card the library lists: a row of fields and a body of Plate
blocks (`@repo/notes/library/library-item`), whatever its kind; a link, a
video, an image, a PDF and a note the person wrote are each one. A markdown
file an import reads becomes one item, its frontmatter read into the item's
fields by `readItemFacts` (`@repo/notes/items/item-frontmatter`). Listed in
memory over a replica's rows by `@repo/notes/library/library-index`.

**kind** — what an item is: `note`, `link`, `video`, `audio`, `image`, `pdf`
or `file` (`ITEM_KINDS` in `@repo/notes/items/item-kind`), one of the item's
fields. An imported markdown file's is its `kind:` key, and a missing or
unknown one is a note; a saved file's is its extension's (`fileKindOf`); a
saved url's is `kindForUrl` (`@repo/notes/items/item-url`). `link`, `video`
and `audio` are the url kinds, the only ones a fill reads.

**Unsorted** — where an item filed in no folder shows: its `folderId` is null
(the `unsorted` scope of `@repo/domain/library-scope`). Not a folder: an item
stays Unsorted until it is filed, whatever it is tagged.

**filing rules** — what the person wrote for the agent about their library, one
row of the account's library cell (`apps/web/src/worker/library/library-rules.ts`)
written only from Settings › Account, which every turn of the built-in agent
carries after the person's message. Tidy my library files and tags by them. An
export writes them as `AGENTS.md`, and an import reads an `AGENTS.md` as a note,
never as filing rules, unless it says what the library's rules say, when it adds
nothing. Not the repo's `AGENTS.md`.

**fill** — the cloud's reading of a link the library holds unread (a
`saveLink`, a refresh, an import's): the cell asks the fill queue, and the
Worker's consumer reads the page with `@repo/page-reader` and lands only its
`article` blocks and the fill-owned fields (`site`, `author`, `published`,
`description`, the cover, the original file of an address that answered with
one, `fetchedAt`, or `fetchError` when the page could not be read), and a title
in place of the address an unread item goes by; it calls no model and never
writes `url` or `savedAt` (`apps/web/src/worker/fill/`). An item's `fetchState` says where it stands:
`pending`, `filled` or `failed`. A page the extension or the phone's share sheet
read an article from is saved read and never filled; one it did not goes to the
fill as its link (`deviceKeepsReading` in `@repo/notes/items/link-fill`).

**cover** — an item's picture: its `coverSha` field, the hash of a file the
library keeps in R2, which a fill sets from the page it read and an export
writes under `assets/covers/` (`COVERS_DIR`). Not an image item: a cover is
part of its item, and is never a card of its own.

**url key** — the one key two spellings of one link share: the scheme, `www.`,
a default port, tracking parameters and a non-route fragment dropped, the host
folded, the query sorted (`urlKey` in `@repo/notes/items/item-url`). A save
folds onto the item holding its key. Not what an item's url holds: that is
`cleanUrl`, which drops only the userinfo and the tracking parameters, and
the key is a derived row, never a field.

## The words the user sees

The product never says git, commit, remote, repo, terminal, CLI, PATH or MCP,
and it calls the whole of it the **library** and what is in it **items**, so
each word below stands for an engine concept with another name in code. Reading
a report or a screenshot means translating back. "Note" means only what the
person writes (New note, the Notes chip); a saved page, a picture or a PDF is an
item, never a note (`tools/repo-guards/src/product-words.test.ts`).

**Library** — the page's home: the account's LIBRARY CELL as the person sees
it, every item one card in one grid
(`apps/workspace/src/app/library/library-view.tsx`), read from this device's
REPLICA. The browser tab opens it at `/library` once signed in.

**Items** — the cards the library lists, one per item row, a note, a saved
link, an image, a PDF or any other file alike
(`@repo/library-replica/library-replica`'s listing). Not docs: a doc is a file
classification of the import and export.

**Unsorted** — the rail's row: every item filed in no folder. A save lands
there when the screen shows no folder.

**Highlights** — a selection marked with ⌘⇧H or Highlight in the toolbar, with
an optional note; the panel's **Highlights** tab lists them with their notes
and replies (`apps/workspace/src/app/panel/annotations-tab.tsx`). Each is an
ANNOTATION, written through the outbox like any edit; a bare one has no note.
"Remove highlight" deletes it. There is no resolve.

**Sync** — the rail footer's state: the replica's outbox and pull against the
account's cell, worded in one place
(`apps/workspace/src/app/sidebar/sync-words.ts`): "Up to date", "Sending N
changes…", "Waiting for a connection", and "N changes not saved" for a write
the cell refused, which waits for the person (Try again, Let it go). Never a
cursor, a head or an outbox.

**Needs a connection** — what a screen says of something only the cloud
answers (History, the agent, import and export, the account) while the device
is offline: the call waits rather than fails
(`apps/workspace/src/app/cloud/needs-connection.tsx`).

**History** — the panel tab listing an item's CHANGE SETS, newest first, each
by who made it and when (`apps/workspace/src/app/panel/history-tab.tsx`).
"Show this version" reads the item as that set left it; **Undo** takes the set
back. Not the editor's own undo (⌘Z), which lives and dies with the open item.

**Undo** — History's button, "Undo this turn" under an agent's turn and "Undo
this conversation" under a conversation: `library.history.undo` over the
CHANGE SETS named, in a change set of its own, so an undo is itself in History.
A block changed since stays, and an item whose later edits overlap the set's is
kept whole and named. An item a rule holds back (a full library, an address
another item holds now) is named apart, and its set can be undone again, as can
a set of which only kept items remain, since nothing of it went back.

**Deleted** — the rail's row: the items deleted, each restorable, and "Empty
Deleted…", which removes them for good.

**Also changed elsewhere** — what the open item says when a write of this
device met another device's change to the same lines of one block: both
changes elsewhere in the block land, and this device's lines are kept where
they overlap (`@repo/editor/stale-write`'s block merge). There is no conflict
state to clear.

**Connect your library** — the browser extension's sign-in: the site's
`/connect/extension` page hands the extension a DEVICE CREDENTIAL of its own
for the signed-in account, and the account's devices list it as Browser
extension (`apps/extension/src/background/connection.ts`).

**Account**, **Devices** and **Connected assistants** — Settings › Account: an
inteligir account (Better Auth, `apps/web/src/worker/auth/auth.ts`), the apps
signed in to it, each
holding a DEVICE CREDENTIAL, and the assistants a person let into the library
through the **connector** (`apps/workspace/src/app/settings/account-section.tsx`).
Each device and assistant can be signed out or disconnected from there; the
browser tab leaves by Sign out.

**Built-in agent** — Settings › Account's switch and the panel's **Agent** tab:
the account's conversations with the BUILT-IN AGENT, the same on every device
(`apps/workspace/src/app/agent/agent-panel.tsx`). "The agent has used today's
allowance" is its `AGENT_BUDGET` refusal.
