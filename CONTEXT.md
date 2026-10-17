# CONTEXT.md — the domain glossary

What the words mean. The decision files (`AGENTS.md` § Decisions) record **why
a choice was made**; this records **what a term names**, where it lives, and
— the part worth reading — the neighbouring concept it gets confused with.

Rules for this file: every entry points at the module that OWNS the concept
rather than restating its implementation, because the module's own header is the
detail and this is the map. An entry that cannot be checked against code does
not belong here.

---

## The vault

**doc** — a file whose extension is editable text: `.md`, `.markdown`, `.mdx`,
`.txt` (`@repo/notes/knowledge/doc-file`, the single source of that answer).
"Doc" is a CLASSIFICATION, not a shape: it decides what the index projects and
what a rename rewrites links in. It is deliberately WIDER than what the client
writes — every note the UI creates is `.md` unless the name typed for it already
ends in a doc extension, so a `.txt` in the vault is indexed and linkable but
minted only by name. It is also WIDER than what a link may leave off: `.md`
alone, so a `.txt` note links as `[[todo.txt]]`.

**note** — a doc as a user and the knowledge surfaces address it: the filename
IS the title, there is no slug layer (`@repo/notes/knowledge/note-name`). A name
may not hold `[` or `]`, which would end a link to it.

**line** — a line's content EXCLUDES its terminator, whichever flavor (`\r\n`,
`\r`, `\n`), stated once in `@repo/notes`' `text/source-lines`. A second reading
of "what a line is" anywhere else is a file-corruption bug waiting to happen;
the line diff's LF-only split (`text/line-diff`) is the one deliberate
exception, because diff3 joins its segments back into the file's own bytes. Not
a write unit: joining a split back rewrites every terminator, so writes go
through the vault's whole-file CAS, never through a re-joined split.

**projection** — what ONE parse of a doc yields: title, headings, links, tags,
aliases, the pin and the note's `id` (`@repo/notes/knowledge/projection`). An
index stores projections, not documents.

**conflict copy** — the other device's whole version of a file both devices
changed where their edits overlap, written beside it as `<name> (conflict,
<device>)<ext>`, while the path keeps the line merge with this device's lines at
the overlaps. A note's copy drops its `id:`, so the two never answer to one
`[[Title|uuid]]` link. Which paths get one is `@repo/notes/sync/reconcile-file`,
the one verdict the desktop's sync and the phone's write queue both run; the
name and the sentence every surface says about it are
`@repo/notes/sync/conflict-copy`. Not the open note's own overlap: a save that
meets a concurrent write merges into the buffer and makes no copy
(`packages/editor/src/vault-editor.ts`), because the person is looking at the
note and its History holds the rest.

**annotation** — a highlighted passage of a note and an optional note on it,
with replies under it: markers `%%i:<ids>:start%%…%%i:<ids>:end%%` around the
passage in the note's bytes, and one entry per id in the store keyed by the
note's frontmatter `id`, `.inteligir/annotations/<id>.json`
(`@repo/notes/annotations/store-schema`; folded against the markers by
`@repo/notes/annotations/annotation-threads`). A root records the `quote` it
was made on, and a root whose `text` is `""` is a bare highlight. Not an html
or code comment, which the dialect keeps as the note's own bytes, and not a
task: it has no resolved state, and stays until it is removed.

## The phone's write queue

The phone's unsent edits (`apps/mobile/src/notes/vault-outbox.ts`) have five
words of their own, used across the outbox, the mirror and the reconcile.

**fence** — a check that the sign-in a piece of work began under is still the
one it may write for (`Fence` in `apps/mobile/src/lib/phone-db.ts`, made by
`apps/mobile/src/lib/sign-in-fence.ts`). Work reads it after every await, and
`fencedExclusive` again inside the transaction, so a wipe queued ahead of a
write wins. A sign-out, a revocation and a new sign-in each make every earlier
fence fall. Not a lock: nothing waits on a fence, and work under one that fell
ends without writing.

**settle** — the one change set an outbox row goes as, kept on the row
(`settle` in `apps/mobile/src/notes/outbox-ops.ts`): a **pin**, or the set
reconciling a stale one made (`apps/mobile/src/notes/outbox-reconcile.ts`),
with the vault's version it was reconciled against and the text it was made
from. A row with no settle goes as its own intent. Not a **turn** settling,
which is a thread's turn ending, and not a refresh's `settled`
(`apps/mobile/src/notes/vault-mirror.ts`), which says the tree it listed agrees
with every write the phone landed since.

**pin** — a text row's first set, kept as its **settle** before it is sent
(`pinText` in `apps/mobile/src/notes/vault-outbox.ts`): a resend after a lost
answer is that same set, which the vault answers as already held, and a text
coalesced meanwhile lands rebased onto it rather than reconciled against the
phone's own write.

**land** — a set the vault committed, moved into the phone's mirror in the
transaction that retires its row (`landInMirror` in
`apps/mobile/src/notes/vault-mirror.ts`), each path it moved stamped so a
refresh that listed the tree before the landing leaves those rows alone. A
text written while the set was out stays queued as a write over what landed.

**park** — an outbox row the vault refused for a reason no resend passes, kept
with its bytes until the user retries it, saves a text or a photo as new, or
discards it (`PARKING_CODES` in `apps/mobile/src/notes/vault-outbox.ts`). The
rows on other paths go on, and a row sharing a path with it waits behind it.
Not unreachable, which stops the whole queue and parks nothing.

## The agent

The four words below are one chain and are constantly swapped for each other.
Read them together.

**thread** — the durable conversation, a row in this app's own SQLite (`threads`
in `@repo/db/schema`). It survives process restarts and owns its title, its
status, the turn that status describes and — for a doc-attached action — its
origin note (see **view context vs thread origin**). Everything the user can
reopen lives here.

**turn** — one request-to-settle exchange inside a thread. It names no table: a
turn exists only as the SCOPE its events share (`@repo/db/ids`), and the
thread's active turn is the one its status describes. The id is the host's
alone, since ACP names no turns
(`apps/cli/src/server/agents/runtime-manager.ts`).

**session** — the PROVIDER's own conversation, cached on the thread row so a
later turn resumes into it (`@repo/db/threads`). A session is disposable: it is
reaped when idle, closed when the host abandons a turn on it, and dies with the
provider process, while the thread and its events do not. Only its harness
travels: another device opens a session of its own. Not to be confused with the
auth **session** in `apps/web` — a signed-in user's row in D1 — which shares
only the word.

**scope** — how far up an event's meaning reaches: the thread, or one turn
(`@repo/domain/thread-event-scope`). Turn scope is the default reading, and each
exception states its reason beside it in the event grammar, so an event that
escapes turn chronology has to justify it in writing. The rule is enforced at
parse and by a CHECK on the `events` table, because a turn-scoped row with no
turn id is a row no query can place.

**view context vs thread origin** — two answers to "which doc is this about",
and they are not interchangeable. A **view context**
(`@repo/domain/view-context`) rides ONE message: the path and the revision its
bytes hashed to at submit, consumed by that turn's prompt. It is EPHEMERAL and a
statement about the PAST — the screen the message left from, which is what
"this" and "here" in it refer to — so nothing has to reconcile it when the user
navigates away. A **thread origin** is the DURABLE binding an action makes: the
note it was composed over, found by the note's frontmatter id so a move anywhere
keeps it (`apps/cli/src/server/threads/thread-origins.ts`). A message can carry
a view context into a thread with no origin. Neither is a **context path**: a
note the user @-mentioned, which rides beside the message's text and, being part
of what was asked rather than a statement about the screen, survives the queue.

**dispatch** — a CLOUD word first: a row in the account's dispatch inbox
(`@repo/contract/cloud/dispatch/dispatch-schema`), the one way a phone asks a
Mac's agent anything: a turn any Mac may claim, or the answer to an **approval**
a Mac opened for a phone-started turn, which only that Mac may claim. A dispatch
is not a thread event: once a Mac takes a turn in, the thread's request row
carries the dispatch id (while the thread is busy, the queued message carries it
until it becomes that row), and the log is the record from then on. Locally the
word also names a runtime handing a turn to its provider
(`apps/cli/src/server/agents/runtime-manager.ts`); the two never meet.

## "event" means four things

Four different layers all say "event", and only the first is durable product
state.

- **thread event** — the PERSISTED log entry (`@repo/domain/provider-event`,
  despite the file's name), one row in the `events` table, sequenced per thread.
  This is what a client replays and what syncs.
- **provider event** — the runtime's EMITTED grammar
  (`@repo/agent-runtime/vocabulary/provider-event`). The two grammars are
  near-twins with the same file name and are not the same set: the runtime
  constructs its events and never parses them, and
  `apps/cli/src/server/agents/runtime-manager.ts` is the one place that narrows
  onto the persisted grammar.
- **sync event** — the cloud's unit of transfer
  (`@repo/contract/cloud/sync/sync-schema`), which the Worker merges, dedupes
  and orders WITHOUT reading. A sync event carries a thread event; it is not
  one.
- **filesystem event** — what the vault watcher reports
  (`apps/cli/src/server/vault/watcher`). Not `fileChange`, a thread event ITEM
  type: the agent's own report of what it wrote, which an agent commit stages.

The local realtime bus is deliberately NOT in this list. It carries **change
kinds** (`@repo/domain/change-kinds`) — invalidation pings naming a
subscription target, never payloads. A client told "events-appended" refetches;
it is never handed the event.

## The words the user sees

The product never says git, commit, remote, repo, terminal, CLI, PATH or MCP,
so each word below stands for an engine concept with another name in code.
Reading a report or a screenshot means translating back.

**Sync** — the rail footer's state, Sync now, and Settings › Vault's Sync row:
the VAULT's pass against where it syncs
(`apps/cli/src/server/vault/git-engine.ts`), worded in one place
(`apps/workspace/src/app/vault-hooks.ts`). "Only on this Mac" is a vault with
nowhere to sync; "Synced by iCloud Drive" is a folder another service syncs,
which the app leaves to it; "Sync paused" is any state only the engine can
explain. Not the THREAD sync: actions reach other devices through the account's
merged log on their own (`apps/cli/src/server/cloud/sync-pass.ts`), with no
button, and never ride the vault's remote.

**History** — the panel tab listing a note's versions: the vault's own git log
for that path (`apps/cli/src/server/vault/git-history.ts`), each version named
by when and by whom (you, the agent, or another device), never by a commit
subject or sha. Restoring one is an ordinary guarded write of its bytes. Not the
editor's own undo (⌘Z), which lives and dies with the open note, and not **Undo
changes**.

**Undo changes** — the button under an agent's reply, and the Undo on the "Agent
edited N notes" toast: a three-way revert of one turn's commit
(`apps/cli/src/server/threads/turn-undo.ts`), which keeps every edit made since;
a note whose later edits overlap the turn's is kept whole and named. Not a
History restore, which puts back exact bytes and so drops whatever came after.

**Kept both versions** — what the window says when a sync met a note two devices
changed on the same lines: the **conflict copy** above, worded by
`@repo/notes/sync/conflict-copy` and said once per report. There is no conflict
state to clear: sync never stops for one.

**Account** and **Devices** — Settings › Account: an inteligir account (Better
Auth, in `apps/web`) and this install's DEVICE CREDENTIAL, the one secret a Mac
or a phone keeps after signing in
(`apps/cli/src/server/cloud/credential-store.ts`). Devices lists the account's
credentials and revokes a lost one; each sign-in mints a new device, and this
Mac leaves only by signing out. Not the agent's sign-in (**Sign in with
Claude**), which holds no inteligir account.

**Advanced** — Settings › Advanced
(`apps/workspace/src/app/settings/advanced-section.tsx`), the one product
surface that keeps the engine's words: where the vault syncs, the raw sync state
and git's last error, the thread sync's, this device's id, the data folder and
the debug-logging switch. Every other surface points here ("Sync details…")
rather than quoting it.

**Connectors** — Settings › Connectors: the MCP servers in the DEFAULT agent's
own user config, read and edited through its bundled binary
(`apps/cli/src/server/connectors/vendor-mcp-config.ts`), and signed in to by the
vendor's own login; the app keeps no registry. Not **Connected folders**
(`folders` in `@repo/contract/local`): directories outside the vault the agent
may read.

**Sign in with Claude** (ChatGPT under Other) — an AGENT's sign-in: the vendor's
own login, run by the server (`apps/cli/src/server/agents/agent-sign-in.ts`)
into the vendor's shared store (`~/.claude`, `~/.codex`). "Claude" is the
`claude` harness and "ChatGPT" the `codex` one (`@repo/domain/harness`); since
the store is shared, signing out here signs the vendor's own app out too. Not an
inteligir **Account**.
