# Private notes (`private: true`)

Add `private: true` to a note's YAML frontmatter (Page details → the `private`
checkbox, or the palette's "Mark note as private") and **the app's own AI
surfaces skip it**. A lock badge in the header shows the state.

Read this whole page before relying on it. The guarantee is narrow, it is
enforced entirely in the client, and **the agent is not part of it**.

## What it does

Everything below runs in the workspace, on the open note, against the live
editor buffer — so a `private: true` you just typed takes effect on the next
action, before any save.

- **Editor AI and ghost text refuse.** The ⌘J menu's generate/edit flows and
  the inline completion both funnel through the same check and do nothing on a
  private note.
- **Read aloud refuses.** The palette hides "Read page aloud" for a private
  note, and `start()` re-checks before sending any bytes to the synthesizer.
- **The chat turn withholds even the PATH.** A fresh user message normally
  carries the open note's path as a context hint; for a private note it carries
  the date-only prefix instead, so the model is not told which file you are
  looking at.

Fail-closed in each case: unparseable frontmatter, an unreadable buffer, and
"nothing registered yet" all read as private.

## What it does NOT do

- **The agent can still read the note.** Its file tools operate on its own copy
  of the vault, and nothing filters them. Ask it to read the file and it will.
- **Search and the knowledge tools still return it.** `search_vault`,
  `get_backlinks`, `get_links`, `related_notes`, `list_vault` and the rest are
  privacy-blind: a private note's path, title and snippet can all come back.
- **Nothing on the host knows about it.** There is no privacy probe, no
  index-level filter and no channel that answers a privacy question. The
  frontmatter key is note content like any other, synced and indexed like any
  other.
- **Delegation and routines do not refuse it.** A background run on a private
  note runs.
- **It is not encryption and not access control.** Anyone with your account has
  the note.

## So what is it for

Keeping a note out of the AI features you did not ask to involve it in — the
completions that fire as you type, the menu you open by accident, the turn that
would have mentioned the file you happen to have open. That is a real and
useful thing, and it is all this is.

It is **not** a boundary. If a note must not reach a model, do not put it in
the vault.

## If you change this

The check is `notePrivacy` in `@repo/notes/markdown/frontmatter` (which treats
unparseable frontmatter as private) reached through `openNoteIsPrivate` in
`@repo/editor/note/open-note-flush`. Adding a host-side guarantee means
designing what enforces it — a host that filters an index is not the same
promise as one that filters the agent's own file reads, and the copy in the
header badge must say whichever one is true.
