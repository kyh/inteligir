# CONTEXT.md — the domain glossary

What the words mean. The decision files (the `CLAUDE.md` beside each
workspace's code) record **why a choice was made**; this records **what a term
names**, where it lives, and the neighbouring concept it gets confused with.

Every entry points at the module that OWNS the concept, whose header is the
detail; an entry states a rule, never a constant or how the code does it, and
one that cannot be checked against code does not belong here.

---

## The library in the cloud

One library cell per account, in Postgres, the devices that read it online,
and the agents that reach it.

**library cell** — one account's whole library in the cloud: its rows in
Postgres, every table keyed by the account (`packages/db/src/library-schema.ts`),
written only in a transaction holding the account's `library_state` row
(`packages/service/src/library/library-store.ts`) and reached only from a
verified **principal**. It holds the items' fields and bodies, their parents, tags,
links, **jobs** and change sets; every `/v1` library call, **connector** call
and **built-in agent** tool reaches it, and the agent's **threads** sit beside
it (`packages/db/src/agent-schema.ts`). The **file store** holds the bytes it
names by hash, and Better Auth's tables the accounts. A client's suites drive
the fake cell (`@repo/contract/test-support/fake-cell.test-utils`) in its place. Not what
a device shows: a device keeps at most a cache of what it last read.

**door** — which device a `/v1` request says it came from, read before its
**session** from a mark no other page can forge: a page of the site's own (a
tab or the Mac app's window), the iPhone, or the browser extension
(`packages/service/src/rpc/admit.ts`); the connector is an assistant's door
alone (`packages/service/src/mcp/connector-server.ts`). Not a route: `/v1/rpc`
and `/v1/blobs/<sha>` admit through every door.

**principal** — who a library call is by, as the cloud verified it at its
**door**: the account and the actor its writes are by (a **session**, a
**connected assistant** under one grant, the only actor with scopes, or the
**built-in agent** in one **turn**), an argument no request can name
(`packages/service/src/library/library-principal.ts`); the rate limits key
on it. Not a credential: the cell never sees one.

**change set** — the unit of undo: what one **turn** of the **built-in agent**
changed, each item it touched kept as the ops that take its fields' changes
back, or as the turn last left one it made, with its body as it stood before the
turn, keyed by the turn and sealed as the turn ends. No other writer keeps one:
a person's, a connected assistant's, an import's, a **sweep**'s and a page's
reading land with nothing to undo. The library keeps each for the undo window
(`packages/service/src/library/library-prunes.ts`), and a set holds only
what is left to take back: an entry goes as an **Undo** settles it.
Not a version: an undo writes forward and keeps no set of its own.

**block** — one top-level element of a note's body, named by its id and its
**section**. The agent edits a body by passage, made on the body as
it stands and made again over a save that lands meanwhile (`packages/service/src/body/edit-body.ts`).
A list item is a block, since lists are flat indent lists. Not a Plate node at
any depth: a block's children are inside it
(`packages/editor/src/headless/body/element-block.ts`).

**section** — which part of an item a **block** belongs to: `note`, what the
person wrote, or `article`, the page's readable text a **fill** wrote. A fill
and Refresh replace only `article` blocks, so reading a page again never
touches the person's writing (`packages/service/src/body/article-body.ts`),
and an agent's edit writes only `note` blocks. Not a heading's stretch of a
note, and not a folder.

**body version** — the count of writes an item's body has taken, which a
device reads with it and saves over: a save over the version the body stands
at lands and takes the next, and one over an older version answers stale
for its device to merge (`packages/service/src/body/write-body.ts`). Not the
item's sequence, which every write to the item moves, and not a history: the
library keeps the body it holds alone.

**head** — the sequence an account's library last took: every write takes the
next and stamps each row it touches with it, so the rows past a head are what
moved since (`packages/db/src/library-schema.ts`).

**what moved** — `library.changes`' answer to a device holding a **head**: the
library's head now, and which items moved past the one sent and at which
sequence, whether the **tree** moved (a folder, list or note), and which threads, a long list saying "all"
(`packages/service/src/library/library-changes.ts`). A device asks the moment
the **heads** it follows say the library moved, every minute besides while in
front, and at once on focus and reconnect, its first ask learning the head alone
(`@repo/client/library-changes`), and asks again for what it shows
of those (`@repo/client/library-cache`). A hint, never the state: an answer
carries no row, so one missed loses nothing.

**heads** — `library.heads`, one response a device holds open that tells the
library's **head** at once and again each time a write moves it, about a second
after (`packages/service/src/library/library-heads.ts`), ending within five
minutes, when the device opens another. It says only that something moved, so
the device asks **what moved**; it carries no row.

**waiting save** — a save a device keeps before its first call and sends until
the cloud answers it, through a relaunch too. One queue
(`packages/client/src/waiting-saves.ts`) under the iPhone's **share outbox**
(`apps/mobile/src/items/share-outbox.ts`) and the browser extension's **save
queue** (`apps/extension/src/background/save-queue.ts`). One the library
refuses is parked with the library's words, for Try again or Let it go. The
only writes a device keeps offline. Not a queue of edits: a save typed into an
app, a photo and a delete each need a connection.

**connector** — the library as a remote MCP server: `/connector`
(`packages/service/src/mcp/connector-server.ts`), the library's procedures
tagged as tools (`packages/service/src/library/library-tools.ts`), behind
Better Auth's OAuth provider with a read-and-change scope, `library`, and a
read-only one, `library:read` (`packages/service/src/auth/oauth-auth.ts`).
Every **connected assistant** calls it, and `/v1` serves the same procedures.
Connector is Claude's word for it and the product's, which never says MCP.

**connected assistant** — the person's own Claude or ChatGPT, signed in to the
**connector** by OAuth, allowed on the consent page `/connect/authorize`
(`apps/web/src/app/(auth)/connect/authorize/`); its model runs on its own
plan, never ours. Each one is a grant, a consent on the account, which
Settings › Account's Connected assistants lists and disconnects
(`packages/service/src/auth/connected-assistants.ts`), and a password reset
disconnects them all.
Not the **built-in agent**, though both call the same tools, and it reads as
a guide the spec the agent's prompt holds.

**built-in agent** — the app's own agent: eve's, in `apps/web/agent`, served
by the deployment under `/eve/v1`, on Claude through AI Gateway, on our bill
within the account's daily allowance. It changes the library only by the
procedures tagged as the **connector**'s tools
(`packages/service/src/agent/agent-tools.ts`); it has no shell or files, it
searches the web and reads public pages, and it deletes or saves a link when
asked, asking nothing more. The person meets it in the panel's
Agent tab and switches it in Settings › Account
(`apps/web/src/library/agent/agent-panel.tsx`); "The agent has used today's
allowance" is its `AGENT_BUDGET` refusal, and "at capacity for today" its
`SERVICE_UNAVAILABLE` once every account's day is spent. Not a **connected
assistant**.

**turn** — one message to the **built-in agent** and the work it does until
Claude ends it, the person stops it or a limit does, a row of `agent_turn`
numbered in its **thread**, which the hooks write as eve starts it. Its
**answer** is what the person reads of it: the reply, its progress notes and its
calls, under which "Undo this turn" reverts its one **change set**. A message
sent while its thread's turn runs joins that turn
(`packages/service/src/agent/eve-agent.ts`). Not a connected assistant's call,
which is no turn.

**allowance** — what the **built-in agent** may spend for an account in a UTC
day, two **turns** and 50 cents of model calls, beside every account's $5
together and a turn's 20 model calls, counted from the account's ledger,
`agent_usage`, which deleting a **thread** leaves as it is
(`packages/service/src/agent/agent-limits.ts`). A turn past it ends `allowance`,
`budget` or `steps`.

**thread** — a conversation with the **built-in agent**, the account's, so
every device shows it: a row of `agent_thread` over one eve session at a time,
and its events as rows of `agent_thread_event`
(`packages/service/src/agent/agent-sessions.ts`), which a device follows as one
stream, the reply drawn as it is written (`packages/service/src/agent/relay.ts`).
Deleting one hides it at once and ends its eve session after. The panel calls it
a conversation.

## The library

**item** — one card the library lists, whatever its kind: a row of fields in
the cell and a body of Plate **blocks** (`@repo/contract/library/library-item`). A link, a video, an image,
a PDF and a note the person wrote are each one, and "item" is the only word for
them: a page is a web page, and a bookmark Raindrop's. The library's listing
follows `@repo/contract/library/library-index`'s rules, in SQL in the cloud,
and answers a screen's pages, the rail's counts, the titles a link shows and an
agent's lists. Not a doc or a file on disk.

**kind** — what an item is: `note`, `link`, `video`, `audio`, `image`, `pdf`
or `file` (`ITEM_KINDS` in `@repo/contract/items/item-kind`). A saved file's is
its type's, a saved url's `kindForUrl`'s, and an imported markdown file's its
`kind:` key, a missing or unknown one a note. `link`, `video` and `audio` are
the url kinds, the only ones a **fill** reads.

**note** — an item of kind `note`, what a person writes (New note, the Notes
chip). A saved page, a picture or a PDF is an item, never a note.

**property** — one of an item's own fields as Info's panel draws it, each
edit one property op (`apps/web/src/library/panel/item-properties.ts`): the
fields stand where a file's frontmatter would. Not an imported file's
frontmatter, which an import reads into the item's fields once
(`@repo/editor/headless/codec/item-fields`): an item has no frontmatter of
its own.

**dialect** — the markdown the library reads and writes: stock CommonMark and
GFM with directives, item links, pills, alerts and **fence blocks**
(`packages/editor/src/headless/markdown/md-rules.ts`). One spec teaches it
(`packages/service/src/agent/prompt/`): the built-in agent's prompt holds it,
and a **connected assistant** reads it as the **connector**'s guide. The
**codec** is the headless converter between an item and its dialect
(`@repo/editor/headless/codec`), which an import, an export, the page reader
and the agent's reads and edits run. Not the editor: the editor edits
**blocks**, never markdown.

**node set** — the one vocabulary of what a body may hold, checked on every
write (`@repo/contract/library/library-nodes`). Not the editor's kits, which
draw it.

**fence blocks** — the three rich blocks the **dialect** writes as a fenced
code block named `inteligir-chart`, `inteligir-canvas` or `inteligir-html`
(`@repo/editor/headless/markdown/fence-langs`). Not a code block, whose
fence names a programming language.

**item link** — a link from one item to another: Plate's mention, its key the
item's id, in markdown `[Title](mention:<id>)`
(`@repo/editor/headless/markdown/md-rules`). It shows the title its item goes
by now, so no rename breaks it. Not a web
link, and not `[[Title]]`, which only an import and the agent's text read, as
an item link to the one item so titled or as the text it is
(`@repo/editor/headless/markdown/remark-wiki-import`).

**Unsorted** — where an item filed under no parent shows: its parent is none,
a deleted item, or no folder, list or note (the `unsorted` scope of
`@repo/contract/library-scope`), the rail's row of that name, and where a save
lands when the screen shows no folder. Not a folder: an item stays Unsorted
until it is filed, whatever it is tagged.

**parent** — the item an item is filed under, by its `parentId`: a folder, a
list or a note, as `canHoldKind` allows (`@repo/contract/items/item-kind`),
never the item itself or one under it (`parentRefusal`,
`@repo/contract/library/cell-rules`). A parent that is deleted or gone leaves
its children at the root. A folder or list is a **container**: it shows in the
rail's tree, never as a card in a live listing, and deleting one deletes the
containers under it. Not a tag, and not a section.

**tree** — the library's folders, lists and notes by their live parents
(`@repo/contract/library/item-tree`): `listing.scopes` answers its containers
with what each holds, and `listing.children` the notes right under a parent,
read as the rail opens one. A `parent` scope lists everything filed anywhere
under that item.

**sweep** — a verb over every item a scope lists but those left out: what ⌘A
then Move, Tag, Pin, Delete or Restore asks once the grid read only part of the
scope, and what "Empty Deleted…" asks (`library.items.sweep`). The library
takes the items the scope lists as it is asked and lands them in the call, a
change of tags over 1,000 items a lot at a time from its jobs
(`packages/service/src/library/library-sweeps.ts`). Not a bulk change, which
names its items by id, a hundred a call.

**job** — work a library write asked for, run once it commits: a row of the
job table, one per subject, which a drain leases and runs
(`packages/service/src/jobs/job-queue.ts`), after the response of the write
that asked it and by the cron every minute. A **fill**, a lot of a **sweep** and
a file's release from the **file store** are jobs. Not a cron: the crons drain
jobs and keep house.

**filing rules** — what the person wrote for the agent about their library,
written only from Settings › Account
(`packages/service/src/agent/agent-preference.ts`). Every turn is sent under
them, after the agent's prompt (`apps/web/agent/instructions/filing-rules.ts`),
a change taken up at the next turn, and Tidy my
library files and tags by them. An import reads an `AGENTS.md` as a note, never
as filing rules. Not the repo's `AGENTS.md`.

**fill** — the cloud's reading of a link the library holds unread (a save, a
**Refresh**, an import's): the write asks a `fill` **job**, whose run reads the
page with `@repo/page-reader` and lands only its `article` blocks and the
fields a fill owns; it calls no model and never writes the url
(`packages/service/src/fill/`). A page the extension read is saved read and
never filled (`@repo/contract/items/link-fill`).

**Refresh** — Read the page again: a fill asked for an item already read, which
replaces only its `article` **section**.

**reading** — whether a saved page has been read into its item: none (a note,
a file), pending, read, or failed with why, the item's one `reading` field,
which every writer moves by one function
(`@repo/contract/library/item-reading`). Not the **fill**: the fill is one
reader that moves it, the extension's read and an import others.

**cover** — an item's picture: the hash of a file the library keeps in the
**file store**,
which a fill sets from the page it read and an import reads from
`assets/covers/`. Not an image item: a cover is part of its item, never a card
of its own.

**file store** — where a file's bytes live, at `files/<account>/<sha>/<nonce>`:
Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, a folder (`FILE_STORE_DIR`)
otherwise (`packages/service/src/files/file-store-of.ts`). A device sends the
bytes straight to it between `library.files.reserve` and `settle`, and an
object no settle kept expires a day on. Not the library's record of a file:
the `file` row names the one object kept for its sha.

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
from the **library cell** through `/v1`, a query per screen that **what
moved** reads again (`apps/web/src/library/`). "Library" in the product is
the whole of it, the tab's home.

**Needs a connection** — what a screen says of something only the cloud
answers while the device is offline: the open item reads but takes no edit
(`packages/editor/src/item/item-editor.tsx`), and in the library tab a call
waits rather than fails (`apps/web/src/library/cloud/needs-connection.tsx`);
the iPhone says it of a save, a photo, a delete and a message or a Stop to the
agent, and keeps only a **waiting save**. Never said of a note that holds its edits back (full, or in
Deleted): each says its own words, and a hold outranks the connection.

**Undo** — "Undo this turn" under an **answer** and "Undo this conversation"
under a conversation, which name a thread and its **turns** and take back what
their **change sets** still hold, while the undo window lasts; a turn with
nothing left offers none, and one pressed twice finds nothing left to undo.
An item goes back whole, its fields and its note together, or not at all: one
edited since, in a field the turn wrote or anywhere in its note, is kept as it
is and named, and so is one a rule held back. Not the editor's ⌘Z, which takes
back only this device's typing.

**Deleted** — the rail's row: the items deleted, each restorable, and "Empty
Deleted…", which removes them for good.

**Sign in to Inteligir** — the browser extension's sign-in, which is the
browser's own: it reads that browser's **session** cookie for the site and
sends its signed value as each save's bearer, so signing out of the site signs
it out too (`apps/extension/src/background/sign-in.ts`). The extension adds no
row to **Devices**.

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

**vault** — Obsidian's word for its folder of notes, which an import reads
from a zip; no product surface says it
(`tools/repo-guards/src/product-words.test.ts`).

**flow** and **spec** — a Playwright test is a flow, and its file under
`tools/e2e/src` a spec.
