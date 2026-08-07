# Privacy

Two things, and the first one has to come before the second.

## Where your notes actually are

**Inteligir is a hosted service. Your notes live on our servers.**

They are plain markdown files and you can take them out whenever you like
(Settings → Account → Export vault gives you every note and attachment as a
zip). But while you use the app, this is where they are:

- **File bytes** — Cloudflare R2, under a prefix belonging to your account.
- **The manifest, the search index, the link graph, your settings, your chat
  transcript with the agent, and the restore points behind "undo"** — a
  Cloudflare Durable Object that exists only for your account.
- **Your account** — email, password hash, sessions — a Cloudflare D1 database.

Nothing here is end-to-end encrypted. The service operator can read your notes,
in the same sense that the operator of any hosted notes app can. If that is not
acceptable for something, do not put it in the vault.

Deleting your account (Settings → Account → Delete account) erases all of it:
the containers, the R2 bytes, and the Durable Object's whole storage, before the
account row goes.

## What a hosted agent implies

The agent is not a text box that reads one note. To edit your files it needs
them, so:

- **The whole vault is copied into a container on every agent turn.** That
  container is per-account, its filesystem is wiped when it sleeps, and its
  network access is limited to the model provider and this app. But for the
  life of a turn, every note you have is on a disk the model can read with
  ordinary file tools.
- **Note content goes to the model provider.** Whatever the agent reads, quotes
  or searches is in the request it sends. That is what the provider you
  connected (Settings → AI) receives, under their terms, not ours.
- **Editor AI, ghost text and dictation are the same shape.** ⌘J and the inline
  completions send the surrounding text; "Read page aloud" sends the note's text
  to the speech vendor; dictation sends your audio to a transcription model.
- **The chat transcript is durable.** It records what the agent did, including
  what it read. Starting a new session (⌘K) rolls a fresh thread; past threads
  stay in the transcript.

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

The check is `notePrivacy` in `@repo/notes/markdown/frontmatter` (which treats
unparseable frontmatter as private) reached through `openNoteIsPrivate` in
`@repo/editor/note/open-note-flush`. Adding a server-side guarantee means
designing what enforces it — a host that filters an index is not the same
promise as one that keeps a note out of the container the agent runs in — and
the copy in the header badge must say whichever one is true.
