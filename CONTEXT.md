# CONTEXT.md — the domain glossary

What the words mean. The decision files (the `CLAUDE.md` beside each
workspace's code) record **why a choice was made**; this records **what a term
names**, where it lives, and the neighbouring concept it gets confused with.

Every entry points at the module that OWNS the concept, whose header is the
detail; an entry states a rule, never a constant or how the code does it, and
one that cannot be checked against code does not belong here.

---

## The library in the cloud

One library cell per account, the devices that read it online, and the agents
that reach it.

**library cell** — one account's whole library: a SQLite Durable Object,
`LibraryDO` (`packages/service/src/library/library-do.ts`), named only from a
verified **principal** or by what the cell itself gave out. It holds the
items' fields, a **seed** for each body no note holds yet, folders, tags,
links, threads, change sets and the account's sockets, and every `/v1` library
call and every **connector** call reaches it; a note's body is its **note
object**'s. R2 holds the bytes it names by hash, and D1 only the accounts. Not
what a device shows: a device keeps at most a cache of what it last read.

**door** — where a request enters the cloud: a Start server route hands it to
one of the service's doors (`packages/service/src/doors.ts`), which says whose
it is. A session comes through the site's tab or the Mac app's window, the
iPhone, or the browser extension, each a door of its own
(`packages/service/src/wire/v1-principal.ts`); the connector is an assistant's
door alone. Not a route: a door answers every method of its paths.

**principal** — who a library call is by, as the Worker verified it at its
**door**: the account and the actor whose **change set** its writes join (a
**session**, or a **connected assistant** under one grant, the only actor with
scopes). The Worker stamps it on the call it forwards to the cell and drops
any copy the request brought (`packages/service/src/library/library-principal.ts`);
the rate limits and the socket's **ticket** key on it. Not a credential: the
cell never sees one.

**change set** — the unit of undo. Every write lands in one, which records each
item it touched before and after, its actor (a person in one session, the
agent, an assistant, an import, a fill or an undo) and when it opened and
sealed. A person's writes seal after a short quiet, their typing in a note
joins no set, a **turn** is one set, and an assistant's writes are one set per
grant until it idles (`SEAL_POLICIES`,
`packages/service/src/library/cell-actor.ts`). An undo is a set of its own,
and the cell keeps each for the undo window
(`packages/service/src/library/change-sets.ts`).

**block** — one top-level element of a note's **live document**, named by its
id and its **section**. The agent edits a body by block id, and a change to a
block that moved since its writer read it is refused with the block as it is.
A list item is a block, since lists are flat indent lists. Not a Plate node at
any depth: a block's children are inside it
(`packages/editor/src/live/element-block.ts`).

**section** — which part of an item a **block** belongs to: `note`, what the
person wrote, or `article`, the page's readable text a **fill** wrote. A fill
and Refresh replace only `article` blocks, so reading a page again never
touches the person's writing (`packages/service/src/note/article-body.ts`).
Not a heading's stretch of a note, and not a folder.

**live document** — a note's body as one Yjs document, each top-level
**block** carrying its **section**, which every device's editor and the agent
edit at once (`packages/editor/src/live/yjs-binding.ts`). An editor's ⌘Z
takes back its own changes alone. Not an offline copy: a device holds it only
while the note's socket is open, and no presence crosses it.

**note object** — `NoteDO`, one Durable Object per item holding its **live
document** (`packages/service/src/note/note-do.ts`), reached by a device on
the account socket's **ticket** and by the agent through the cell, by block id.
Its first load takes the cell's **seed**, and each save pushes a
**projection**. Its standing is open, full, in Deleted or gone
(`packages/service/src/note/note-standing.ts`): an item in Deleted or a full
note opens read-only, and a purged one is gone for good. Not the **library
cell**: typing never passes through it.

**seed** — the body the **library cell** keeps for an item until its **note
object** first opens, written by a save, a fill, an import or a new note, and
dropped once the note says it stored it
(`packages/service/src/library/cell-body.ts`). Not a cache: once the note
holds the body, the cell never takes it back.

**projection** — what a **note object** tells the **library cell** of its
body as it saves: the digest a listing and search read, its text, its links
and its size, a late push stale (`packages/service/src/note/note-wire.ts`). It
joins no **change set**. Not the body: the cell keeps what it derives, never
the note's blocks.

**turn log** — a **note object**'s record of each agent **turn** that edited
it, from which Undo this turn takes the turn back as a forward edit, keeping
every later edit (`packages/service/src/note/turn-log.ts`). Not a version
history: it holds only agent turns.

**account socket** — the one socket a device holds to its account's cell:
opened on a **ticket**, kept alive by the cell's ping, redialled on a growing
wait when it drops, and read again whole each time it comes up
(`@repo/client/account-socket`). It carries **moved frames** and `preview`
frames, the reply the agent is writing, which no read answers. Its frames are
the contract's (`@repo/contract/library/library-socket`).

**ticket** — the minute-long pass an authenticated `/v1` call mints for its
**principal**, which opens the **account socket** and a note's socket, since a
browser's socket carries no header
(`packages/service/src/library/socket-ticket.ts`). Not a credential a device
keeps.

**moved frame** — the **account socket**'s word that a write committed: which
items it moved and at which sequence, whether a folder moved, and which
threads, a long list saying "all" (`packages/service/src/library/cell-moved.ts`).
A device asks again for what it shows of those
(`@repo/client/library-cache`). A hint, never the state: a frame carries no
row, so one missed loses nothing.

**waiting save** — a save a device keeps before its first call and sends until
the cloud answers it, through a relaunch too: the iPhone's **share outbox**
(`apps/mobile/src/items/share-outbox.ts`) and the browser extension's **save
queue** (`apps/extension/src/background/save-queue.ts`). The iPhone parks a
share the cloud refuses, with its words, for Try again or Let it go. The only
writes a device keeps offline. Not a queue of edits: a save typed into an app,
a photo and a delete each need a connection.

**connector** — the library as a remote MCP server: `/connector` on the Worker
(`packages/service/src/connector/connector-route.ts`), the library's procedures
tagged as tools (`library-tools.ts`) and served in the account's cell, behind
OAuth with a read-and-change scope, `library`, and a read-only one,
`library:read` (`connector-auth.ts`). Every **connected assistant** calls it,
and `/v1` serves the same procedures. Connector is Claude's word for it and the
product's, which never says MCP.

**connected assistant** — the person's own Claude or ChatGPT, signed in to the
**connector** by OAuth on our consent page
(`packages/service/src/connector/consent-route.ts`); its model runs on its own
plan, never ours. Each one is a grant on the account, which Settings ›
Account's Connected assistants lists and disconnects (`assistant-grants.ts`).
Not the **built-in agent**, though both call the same tools.

**built-in agent** — the app's own agent: our loop over Claude, one Durable
Object for each **thread** (`packages/service/src/agent/agent-thread.ts`),
through AI Gateway, on our bill within the account's daily allowance. It
changes the library only through the account's cell, by the procedures the
**connector** serves; it has no shell, files or web of its own, and deleting
and saving a link ask the person first. The person meets it in the panel's
Agent tab and switches it in Settings › Account
(`apps/web/src/library/agent/agent-panel.tsx`); "The agent has used today's
allowance" is its `AGENT_BUDGET` refusal. Not a **connected assistant**.

**turn** — one message to the **built-in agent** and the work it does until
Claude ends it, the person stops it, or its step cap does
(`AGENT_MAX_STEPS`); waiting on an approval does not end it. Its **answer** is
what the person reads of it: the reply, its progress notes and its calls, under
which "Undo this turn" reverts its one **change set**. The cell counts it
against the day before it starts, and a send while its thread's turn runs
waits its turn (`packages/service/src/agent/agent-turns.ts`). Not a connected
assistant's call, which is no turn.

**thread** — a conversation with the **built-in agent**, the account's, so
every device shows it: its transcript in its own object and its events as rows
of the cell (`agent-turns.ts`). The panel calls it a conversation.

## The library

**item** — one card the library lists, whatever its kind: a row of fields in
the cell and a body of Plate **blocks**, its **note object**'s **live
document** (`@repo/contract/library/library-item`). A link, a video, an image,
a PDF and a note the person wrote are each one, and "item" is the only word for
them: a page is a web page, and a bookmark Raindrop's. The cell holds the
listing over its items between calls
(`@repo/contract/library/library-index`), which answers a screen's pages, the
rail's counts and the titles a link shows. Not a doc or a file on disk.

**kind** — what an item is: `note`, `link`, `video`, `audio`, `image`, `pdf`
or `file` (`ITEM_KINDS` in `@repo/contract/items/item-kind`). A saved file's is
its type's, a saved url's `kindForUrl`'s, and an imported markdown file's its
`kind:` key, a missing or unknown one a note. `link`, `video` and `audio` are
the url kinds, the only ones a **fill** reads.

**note** — an item of kind `note`, what a person writes (New note, the Notes
chip). A saved page, a picture or a PDF is an item, never a note.

**property** — one of an item's own fields as Info's panel draws it, each
edit one property op (`packages/editor/src/item/item-properties.ts`): the
fields stand where a file's frontmatter would. Not an imported file's
frontmatter, which an import reads into the item's fields once
(`@repo/editor/items/item-frontmatter`): an item has no frontmatter of its own.

**dialect** — the markdown the library reads and writes: stock CommonMark and
GFM with directives, item links, pills, alerts and **fence blocks**
(`packages/editor/src/markdown/md-rules.ts`), which `@repo/agent-skills`
teaches the agent. The **codec** is the headless converter between an item and
its dialect (`@repo/editor/codec`), which an import and the agent's reads and
edits run. Not the editor: the editor edits **blocks**, never markdown.

**node set** — the one vocabulary of what a body may hold, checked on every
write (`@repo/contract/library/library-nodes`). Not the editor's kits, which
draw it.

**fence blocks** — the three rich blocks the **dialect** writes as a fenced
code block named `inteligir-chart`, `inteligir-canvas` or `inteligir-html`
(`@repo/editor/markdown/fence-langs`). Not a code block, whose fence names a
programming language.

**item link** — a link from one item to another: Plate's mention, its key the
item's id, in markdown `[Title](mention:<id>)` (`@repo/editor/markdown/md-rules`).
It shows the title its item goes by now, so no rename breaks it. Not a web
link, and not `[[Title]]`, which only an import and the agent's text read, as
an item link to the one item so titled or as the text it is
(`@repo/editor/markdown/remark-wiki-import`).

**Unsorted** — where an item filed in no folder shows: its folder is none or a
deleted one (the `unsorted` scope of `@repo/contract/library-scope`), the
rail's row of that name, and where a save lands when the screen shows no
folder. Not a folder: an item stays Unsorted until it is filed, whatever it is
tagged.

**filing rules** — what the person wrote for the agent about their library,
written only from Settings › Account
(`packages/service/src/library/library-rules.ts`). A conversation carries them
after the person's message, sent again only when they change, and Tidy my
library files and tags by them. An import reads an `AGENTS.md` as a note, never
as filing rules. Not the repo's `AGENTS.md`.

**fill** — the cloud's reading of a link the library holds unread (a save, a
**Refresh**, an import's): the cell asks the fill queue, and the Worker's
consumer reads the page with `@repo/page-reader` and lands only its `article`
blocks and the fields a fill owns; it calls no model and never writes the url
(`packages/service/src/fill/`). A page the extension read is saved read and
never filled (`@repo/contract/items/link-fill`).

**Refresh** — Read the page again: a fill asked for an item already read, which
replaces only its `article` **section**.

**reading** — whether a saved page has been read into its item: none (a note,
a file), pending, read, or failed with why, one value every writer moves and
every surface reads alike (`@repo/contract/library/item-reading`). Not the
**fill**: the fill is one reader that moves it, the extension's read and an
import others.

**cover** — an item's picture: the hash of a file the library keeps in R2,
which a fill sets from the page it read and an import reads from
`assets/covers/`. Not an image item: a cover is part of its item, never a card
of its own.

**url key** — the one key two spellings of one link share
(`urlKey` in `@repo/contract/items/item-url`): a save of a url whose key a live
item holds answers that item. Not what an item's url holds: that is
`cleanUrl`'s, and the key is a derived row, never a field.

## The words the user sees

The product speaks the person's words (`AGENTS.md` § Rules that matter), so
each word below stands for a concept with another name in code; reading a
report or a screenshot means translating back.

**library tab** — the library as the person sees it at `/library`, in a
browser tab or the Mac app's window: every item one card in one grid, read
from the **library cell** through `/v1`, a query per screen that the **account
socket** invalidates (`apps/web/src/library/`). "Library" in the product is
the whole of it, the tab's home.

**Needs a connection** — what a screen says of something only the cloud
answers while the device is offline: the open item reads but takes no edit
(`packages/editor/src/item/item-editor.tsx`), and in the library tab a call
waits rather than fails (`apps/web/src/library/cloud/needs-connection.tsx`);
the iPhone says it of a save, a photo and a delete, and keeps only a
**waiting save**. Never said of a note that holds its edits back (full, or in
Deleted): each says its own words, and a hold outranks the connection.

**Undo** — "Undo this turn" under an **answer** and "Undo this conversation"
under a conversation, which revert the named **change sets** while their undo
window lasts. What an agent's turn wrote in a note, that note takes back from
its **turn log**, and Undo names each note where typing inside a block the turn
added went with it, each item a later edit kept whole, and each a rule held
back. Not the editor's ⌘Z, which takes back only this device's typing.

**Deleted** — the rail's row: the items deleted, each restorable, and "Empty
Deleted…", which removes them for good.

**Sign in to Inteligir** — the browser extension's sign-in, which is the
browser's own: it sends that browser's **session** cookie for the site with
each save, so signing out of the site signs it out too. The site's
`/connect/extension` page only tells it where the site is
(`apps/extension/src/background/sign-in.ts`). The extension adds no row to
**Devices**.

**session** — one device's sign-in, Better Auth's own row: a browser tab or
the Mac app's window holds its cookie, the iPhone keeps it in the Keychain,
and the browser extension rides its browser's. It slides with each use, an
account holds a capped number, a sign-in past the cap ending the one used
longest ago, and a password reset ends them all
(`packages/service/src/auth/auth.ts`). Not a credential of our own: there is
none.

**Account**, **Devices** and **Connected assistants** — Settings › Account: the
account, its **sessions** listed by the device each names, This device marked,
and the **connected assistants**
(`apps/web/src/library/settings/account-section.tsx`). Every other device can
be signed out from there and every assistant disconnected; this device leaves
by Sign out.

## Words of the repo

**vault** — survives only as the production R2 bucket's name,
`inteligir-vault`, which holds the library's files; never rename it, and no
product surface says it.

**flow** and **spec** — a Playwright test is a flow, and its file under
`tools/e2e/src` a spec.
