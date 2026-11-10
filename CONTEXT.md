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

One library cell per account, the devices that read it online, and the agents
that reach it.

**library cell** — one account's whole library: a SQLite Durable Object,
`LibraryDO`, in the Worker (`packages/service/src/library/library-do.ts`), named
`library:<userId>` only from a verified session or grant, or from what the cell itself
gave out: a fill message or a conversation's name. It holds the items,
their **blocks**, folders, tags, links, threads, change sets and the
account's live sockets, and it is the library's only writer: every `/v1`
library call and every **connector** call is forwarded to it. R2 holds the
bytes it names by hash, and D1 only the accounts. Not what a device shows:
every app reads the cell online, and keeps at most a cache of what it last
read, which a **moved frame** tells it to read again.

**principal** — who a library call is by, as the Worker verified it: the
account and the actor whose **change set** its writes join (a **session**,
named by the door it came through: the site's tab or the Mac app's window, the
iPhone, or the browser extension; or a **connected assistant** under one grant,
the only actor with scopes). The Worker
stamps it on the call it forwards to the **library cell** and drops any copy the
request brought (`packages/service/src/library/library-principal.ts`). Not a
credential: the cell never sees one.

**change set** — the unit of undo. Every write lands in one,
which records each item it touched before and after, its actor (the person,
the agent, an assistant, an import, a fill or an undo) and when it opened and
sealed. A device's typing seals after 15 s of quiet or 60 s in all;
a **turn** is one set; a **connected assistant**'s writes are one set per
grant, sealed after 10 idle minutes. Undo reverts sets three-way, newest
first, and keeps every later edit; an undo is a set of its own. The cell keeps
each until seven days after it sealed
(`packages/service/src/library/change-sets.ts`,
`packages/service/src/library/change-set-prune.ts`), and the revert is
`@repo/service/library/revert-change`'s.

**block** — one top-level element of a note's live document, a Plate element
named by its id and its **section**. The agent edits a body by block id: a
change names the block as the writer read it, and one whose block moved since
is refused with the block as it is. A list item is a block, since lists are
flat indent lists. Not a Plate node at any depth: a block's children are inside
it. Its vocabulary is `@repo/contract/library/library-nodes`, how the editor
reads one `packages/editor/src/live/element-block.ts`.

**section** — which part of an item a **block** belongs to: `note`, what the
person wrote, or `article`, the page's readable text a fill wrote. A fill and
Refresh replace only `article` blocks, so reading a page again never touches
the person's writing. An item reads its note before its article
(`@repo/contract/library/block-order`), and its markdown writes the article as
one top-level `article` container after the note, its colon fence longer than
any inside it (`@repo/editor/codec/item-markdown`).
Not a heading's stretch of a note (its outline), and not a folder.

**moved frame** — what the account's socket tells every device once a write
commits: each item it moved at its sequence, whether a folder moved, and which
threads, a list past `MOVED_IDS_MAX` saying "all"
(`packages/service/src/library/cell-moved.ts`, the frame in
`@repo/contract/library/library-socket`). A device asks again for what
it shows of those, and for everything each time its socket opens
(`@repo/contract/library/account-socket`). A hint, never the state: a
frame carries no row, so one missed loses nothing.

**share outbox** — the iPhone's shares from other apps still to land, each kept
in its key-value store before its first call and sent until the cloud answers
it, through a relaunch too (`apps/mobile/src/items/share-outbox.ts`); a share
the cloud refuses is **parked** with its words, for Try again or Let it go.
The one write a device keeps offline, with the browser extension's retry
queue, which holds a save's url and title the same way. Not a queue of edits:
typing, a save typed into the app, a photo and a delete each need a
connection.

**connector** — the library as a remote MCP server: `/connector` on the Worker
(`packages/service/src/connector/connector-route.ts`), the library's procedures
tagged as tools
(`packages/service/src/connector/library-tools.ts`) and served in the account's
cell (`connector-server.ts`), behind OAuth from
`@cloudflare/workers-oauth-provider` (`connector-auth.ts`) with a
read-and-change scope, `library`, and a read-only one, `library:read`. Every
**connected assistant** calls it. `/v1` serves the same procedures, of which
the apps call only a few, and the **built-in agent**'s cell runs them for it
with no connector between. Connector is Claude's word for it and the
product's, which never says MCP.

**connected assistant** — the person's own Claude (claude.ai, Claude Desktop,
Claude Code) or ChatGPT, signed in to the **connector** by OAuth on our
consent page (`packages/service/src/connector/consent-route.ts`); its model
runs on its own plan, never ours. Each one is a grant on the account, which
`account.assistants` lists and revokes (`assistant-grants.ts`), and Settings ›
Account shows. Not the **built-in agent**, though both call the same tools.

**built-in agent** — the app's own agent: our loop over Claude, a Durable
Object for each **thread** (`packages/service/src/agent/agent-thread.ts`),
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
waits its turn (`packages/service/src/agent/agent-turns.ts`). Not a connected
assistant's call, which is no turn.

**thread** — a conversation with the **built-in agent**, the account's, so
every device shows it: its transcript in its own object and its events as rows
of the cell, which each device reads online (`agent-turns.ts`).

## The library

**doc** — a file whose extension is editable text: `.md`, `.markdown`, `.mdx`,
`.txt` (`@repo/contract/knowledge/doc-file`, the single source of that answer).
"Doc" is a CLASSIFICATION, not a shape: it decides which file of an imported
zip becomes a note. It is deliberately WIDER than what the codec writes, every
note as `.md`, and WIDER than what a zip's link may leave off: `.md` alone, so
a `.txt` note in a zip links as `[[todo.txt]]`.

**note** — an item of kind `note`, the text a person writes. An imported doc
whose `kind:` is missing or unknown is one, its filename its title, with no
slug layer.
The name the codec writes an item under follows one rule,
`@repo/contract/items/item-name`, whatever its kind: a title is repaired into a
name every disk takes, never refused, and its `[` and `]`, which would end a
link to it, become `(` and `)`.

**page link** — a link from one item to another: Plate's mention, its key the
item's id and its value the title it was written with, in markdown
`[Title](mention:<id>)` (`@repo/editor/markdown/md-rules`). It shows the title
its item goes by now, so no rename breaks it. Not a web link, and not
`[[Title]]`, which only an import and the agent's text read, as a page link to
the one item so titled or as the text it is
(`@repo/editor/markdown/remark-wiki-import`).

**line** — a line's content EXCLUDES its terminator. The markdown codec reads
`\r\n` and `\r` as `\n` at every entry (`lfOnly` in
`@repo/editor/markdown/md-read`), so past it every line ends in `\n`; the line
diff splits on `\n` alone (`text/line-diff`), because diff3 joins its segments
back into the text's own bytes. Not a write unit: a block is, guarded by its
hash.

## Items

**library** — everything a person saved and wrote, their account's: one
library cell in the cloud (`LibraryDO`, `packages/service/src/library/`), which
every device they sign in on reads online.

**item** — one card the library lists: a row of fields and a body of Plate
blocks (`@repo/contract/library/library-item`), whatever its kind; a link, a
video, an image, a PDF and a note the person wrote are each one. A markdown
file an import reads becomes one item, its frontmatter read into the item's
fields by `readItemFacts` (`@repo/editor/items/item-frontmatter`). Listed in
memory by `@repo/contract/library/library-index`, which the cell builds over its
rows for each `library.listing.page`.

**kind** — what an item is: `note`, `link`, `video`, `audio`, `image`, `pdf`
or `file` (`ITEM_KINDS` in `@repo/contract/items/item-kind`), one of the item's
fields. An imported markdown file's is its `kind:` key, and a missing or
unknown one is a note; a saved file's is its extension's (`fileKindOf`); a
saved url's is `kindForUrl` (`@repo/contract/items/item-url`). `link`, `video`
and `audio` are the url kinds, the only ones a fill reads.

**Unsorted** — where an item filed in no folder shows: its `folderId` is null
or names a deleted folder (the `unsorted` scope of
`@repo/contract/library-scope`). Not a folder: an item stays Unsorted until it is
filed, whatever it is tagged.

**filing rules** — what the person wrote for the agent about their library, one
row of the account's library cell (`packages/service/src/library/library-rules.ts`)
written only from Settings › Account, which every turn of the built-in agent
carries after the person's message. Tidy my library files and tags by them. An
import reads an `AGENTS.md` as a note, never as filing rules, unless it says what the library's rules say, when it adds
nothing. Not the repo's `AGENTS.md`.

**fill** — the cloud's reading of a link the library holds unread (a
`saveLink`, a refresh, an import's): the cell asks the fill queue, and the
Worker's consumer reads the page with `@repo/page-reader` and lands only its
`article` blocks and the fill-owned fields (`site`, `author`, `published`,
`description`, the cover, the original file of an address that answered with
one, `fetchedAt`, or `fetchError` when the page could not be read), and a title
in place of the address an unread item goes by; it calls no model and never
writes `url` or `savedAt` (`packages/service/src/fill/`). An item's `fetchState` says where it stands:
`pending`, `filled` or `failed`. A page the extension read an article from is
saved read and never filled; one it did not goes to the
fill as its link (`deviceKeepsReading` in `@repo/contract/items/link-fill`).

**cover** — an item's picture: its `coverSha` field, the hash of a file the
library keeps in R2, which a fill sets from the page it read and an import reads
from `assets/covers/` (`COVERS_DIR`). Not an image item: a cover is
part of its item, and is never a card of its own.

**url key** — the one key two spellings of one link share: the scheme, `www.`,
a default port, tracking parameters and a non-route fragment dropped, the host
folded, the query sorted (`urlKey` in `@repo/contract/items/item-url`). A save of
a url whose key a live item holds answers that item. Not what an item's url holds: that is
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
(`apps/web/src/library/library/library-view.tsx`), read from the LIBRARY
CELL through `/v1`, a query per screen that the account's socket invalidates
(`apps/web/src/library/cloud/library-queries.ts`). The browser tab opens it
at `/library` once signed in.

**Items** — the cards the library lists, one per item row, a note, a saved
link, an image, a PDF or any other file alike
(`library.listing.page`). Not docs: a doc is a file
classification of the import.

**Unsorted** — the rail's row: every item filed in no folder. A new save lands
there when the screen shows no folder.

**Needs a connection** — what a screen says of something only the cloud
answers (the open item's typing, ⌘P's search, the agent and its Undo, import,
the account) while the device is offline: the open item reads but takes no
edit (`packages/editor/src/item/item-editor.tsx`), and on the library's page a
call waits rather than fails
(`apps/web/src/library/cloud/needs-connection.tsx`); the iPhone says it of a
save, a photo and a delete, and keeps only a share
(**share outbox**).

**Undo** — "Undo this turn" under an agent's turn and "Undo this conversation"
under a conversation: `library.history.undo` over the CHANGE SETS named, in a
change set of its own, for seven days after each set sealed. Not the editor's
own undo (⌘Z), which lives and dies with the open item.
A block changed since stays, and an item whose later edits overlap the set's is
kept whole and named. An item a rule holds back (a full library, an address
another item holds now) is named apart, and its set can be undone again, as can
a set of which only kept items remain, since nothing of it went back.

**Deleted** — the rail's row: the items deleted, each restorable, and "Empty
Deleted…", which removes them for good.

**Sign in to Inteligir** — the browser extension's sign-in, which is the
browser's own: the extension reads that browser's **session** cookie for the
site and sends it with each save, so signing out of the site signs it out too.
The site's `/connect/extension` page only tells it where the site is and is
answered with the account it found signed in there; nothing crosses, and the
extension adds no row to **Devices**
(`apps/extension/src/background/sign-in.ts`,
`apps/extension/src/background/connection.ts`).

**session** — one device's sign-in, Better Auth's own row: a browser tab or the
Mac app's window holds its cookie, the iPhone keeps it in the Keychain, and the
browser extension rides its browser's. It lasts 60 days from its last use, an
account holds 20 (a sign-in past that ends the one used longest ago), and a
password reset ends them all (`packages/service/src/auth/auth.ts`). Not a
credential of our own: there is none.

**Account**, **Devices** and **Connected assistants** — Settings › Account: an
inteligir account (Better Auth, `packages/service/src/auth/auth.ts`), its
**sessions**, each listed by the device its user agent names (Chrome on Mac,
iPhone) with This device marked, and the assistants a person let into the
library through the **connector**
(`apps/web/src/library/settings/account-section.tsx`). Every other device
can be signed out from there and every assistant disconnected; this device
leaves by Sign out.

**Built-in agent** — Settings › Account's switch and the panel's **Agent** tab:
the account's conversations with the BUILT-IN AGENT, the same on every device
(`apps/web/src/library/agent/agent-panel.tsx`). "The agent has used today's
allowance" is its `AGENT_BUDGET` refusal.
