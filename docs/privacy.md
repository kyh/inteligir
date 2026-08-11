# Privacy

Two things, and the first one has to come before the second.

## Where your notes actually are

**Inteligir is a hosted service. Your notes live on our servers.**

They are plain markdown files and you can take them out whenever you like
(Settings → Account → Export vault gives you every live note and attachment as a
zip — up to 65,535 files and 3.5 GB, past which the zip format itself gives out
and the export refuses rather than truncating). But while you use the app, this
is where they are:

- **File bytes, and the restore points behind "undo"** — Cloudflare R2, under a
  prefix belonging to your account (a restore point is a copy of the file, kept
  under `.snapshots/` in that same prefix).
- **The manifest, the search index, the link graph, your settings, and your chat
  transcript with the agent** — a Cloudflare Durable Object that exists only for
  your account.
- **Your account** — email, password hash, sessions — a Cloudflare D1 database.

Nothing here is end-to-end encrypted. The service operator can read your notes,
in the same sense that the operator of any hosted notes app can. If that is not
acceptable for something, do not put it in the vault.

**Deleting a note is a tombstone, not an erase.** Its bytes stay in R2 for 30
days before a sweep removes them. There is no trash view, no way to purge
sooner, and an export does not include them — so for those 30 days the service
holds content you believe you deleted. The tier exists because undoing a note
the agent created is a delete, and with nothing behind it every such undo would
be permanent.

Deleting your account (Settings → Account → Delete account) erases all of it —
including the tombstoned bytes: the containers, the R2 prefix, and the Durable
Object's whole storage, before the account row goes.

## What a hosted agent implies

The agent is not a text box that reads one note. To edit your files it needs
them, so:

- **The whole vault is materialized into a container.** It is copied in full
  when the container wakes and kept in sync by delta after that. That container
  is per-account, its filesystem is wiped when it sleeps, and its network access
  is limited to the model provider and this app (a deployment can widen that
  list — `AGENT_EXTRA_ALLOWED_HOSTS`; ours is what `agent/sandbox-class.ts`
  builds). But for the life of a turn, every note you have is on a disk the
  model can read with ordinary file tools.
- **Note content goes to the model provider.** Whatever the agent reads, quotes
  or searches is in the request it sends. That is what the provider you
  connected (Settings → AI) receives, under their terms, not ours.
- **Editor AI, ghost text and dictation are the same shape, and two of them
  reach vendors you did not pick.** ⌘J and the inline completions send the
  surrounding text to the provider you connected. "Read page aloud" sends the
  note's text to **ElevenLabs**, on the key you configured in Settings → Voice.
  Dictation sends your audio to **Cloudflare Workers AI** (Whisper) through our
  account — that one is not a provider you chose.
- **The chat transcript is durable.** It records what the agent did, including
  what it read. Starting a new session (Settings → New session) rolls a fresh
  thread; past threads stay in the transcript. The agent's own live session is
  replaced with it, so the next message is answered without the thread you left
  behind.

## `private: true` — what it is

Add `private: true` to a note's YAML frontmatter (Page details → the `private`
checkbox, or the palette's "Mark note as private") and **the app's own AI
surfaces skip it**. A lock badge in the header shows the state.

It is enforced entirely in the client, on the open note, against the live editor
buffer — so a `private: true` you just typed takes effect on the next action,
before any save.

- **Editor AI and ghost text refuse.** The ⌘J menu's generate and edit flows and
  the inline completion funnel through the same check and do nothing.
- **Read aloud refuses.** The palette hides it, and the speak path re-checks
  before sending any bytes.
- **A chat turn withholds even the PATH.** A user message normally carries the
  open note's path as a context hint; for a private note it carries the
  date-only prefix instead, so the model is not told which file you are looking
  at.

Fail-closed in each case: unparseable frontmatter, an unreadable buffer, and
"nothing registered yet" all read as private.

## `private: true` — what it is NOT

- **The agent can still read the note.** The whole vault is materialized into
  its container; nothing filters its file tools. Ask it to read the file and it
  will.
- **Search and the knowledge tools still return it.** `search_vault`,
  `get_backlinks`, `get_links`, `related_notes`, `list_vault` and the rest are
  privacy-blind: a private note's path, title and snippet can all come back.
- **The server does not know about it.** There is no privacy probe, no
  index-level filter and no channel that answers a privacy question. The
  frontmatter key is note content like any other, stored and indexed like any
  other.
- **Delegation and routines do not refuse it.** A background run on a private
  note runs.
- **It is not encryption and not access control.** Anyone with your account has
  the note. So does the service.

## So what is it for

Keeping a note out of the AI features you did not ask to involve it in — the
completions that fire as you type, the menu you open by accident, the turn that
would have mentioned the file you happen to have open. That is a real and useful
thing, and it is all this is.

It is a **client-side gesture**, not a boundary. If a note must not reach a
model, do not put it in the vault.

## If you change this

There are TWO gates, both client-side, both over the same `privacyOfParsed`
kernel in `@repo/notes/markdown/frontmatter` (which answers `indeterminate` for
frontmatter it cannot type; every AI caller fails closed by treating anything
but `public` as private):

- `openNoteIsPrivate` in `@repo/editor/note/open-note-flush` — the chat context
  hint and read-aloud, off the flushed open-note state.
- `isEditorNotePrivate` in `@repo/editor/note-privacy` — ⌘J and ghost text, off
  the live Plate document.

Change both, or the guarantee is half true. Adding a server-side guarantee means
designing what enforces it — a host that filters an index is not the same
promise as one that keeps a note out of the container the agent runs in — and
the copy in the header badge must say whichever one is true.
