# CONTEXT.md — the domain glossary

What the words mean. `CLAUDE.md` § Decisions records **why a choice was made**;
this records **what a term names**, where it lives, and — the part worth
reading — the neighbouring concept it gets confused with.

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
writes — every note the UI creates is `.md`
(`apps/desktop/src/renderer/app/vault-hooks.ts`,
`packages/editor/src/note/vault-session.ts`), so a `.txt` in the vault is
indexed and linkable but never minted here.

**note** — a doc as a user and the knowledge surfaces address it: the filename
IS the title, there is no slug layer (`@repo/notes/knowledge/note-name`).

**line** — a line's content EXCLUDES its terminator, whichever flavor
(`\r\n`, `\r`, `\n`). That rule is stated once, in `@repo/notes`'
`knowledge/source-lines`, and read once, by `splitLines` — the task scan reads
a checkbox's text under it and the projection cuts link snippets under it. A
second reading of "what a line is" anywhere else is a file-corruption bug
waiting to happen; `text/line-diff`'s `splitLinesLf` is the one deliberate
exception, LF-only because diff3 joins its segments back into the file's own
bytes. Note what the split is NOT for: joining back rewrites every terminator
in the file, so a CRLF doc saved after ticking one box would come back with
every line changed. Writes go through the vault's whole-file CAS, never through
a re-joined split.

**projection** — what ONE parse of a doc yields: title, headings, links, tags,
aliases, tasks (`@repo/notes/knowledge/projection`, `projectDoc`). An index
stores projections, not documents.

## The agent

The four words below are one chain and are constantly swapped for each other.
Read them together.

**thread** — the durable conversation, a row in this app's own SQLite
(`threads` in `@repo/db/schema`, id `thr_…`). It survives process restarts,
owns its title, status, `activeTurnId` and — for a doc-attached action — the
path it was spawned from. Everything the user can reopen lives here.

**turn** — one request-to-settle exchange inside a thread. It names no table:
a turn exists only as the SCOPE its events share (`@repo/db/ids`, id `turn_…`),
and `threads.activeTurnId` is the one the current status describes — bound by
`run.started`, unbound by every settle.

**session** — the PROVIDER's own conversation, `{ providerId, providerThreadId }`
(`setThreadProviderSession` in `@repo/db/threads`, the one writer), cached on
the thread row so a later turn resumes into it. A session is disposable: it is
reaped when idle and dies with the provider process, while the thread and its
events do not. Not to be confused with the auth **session** in `apps/web` — a
signed-in user's row in D1 — which shares only the word.

**host turn id vs provider turn id** — TWO id spaces for one turn, and the
distinction is load-bearing. The service mints the host id (`turn_…`) and hands
it to `startTurn`; the harness mints its own and puts it in its events. The
first `turn/started` BINDS the two, and
`apps/cli/src/server/agents/runtime-manager.ts` rewrites every turn-scoped event
through that binding — so an event naming any other provider turn (a resume
replay) is dropped rather than persisted. Everything stored, subscribed to or
shown is the HOST id; the provider id is only ever spoken to the provider.

**scope** — how far up an event's meaning reaches: `{ kind: "thread" }` or
`{ kind: "turn", turnId }` (`@repo/domain/thread-event-scope`). Turn scope is
the default reading; the per-type policy table names every exception and makes
each state its reason, so an event that escapes turn chronology has to justify
it in writing. The rule is enforced twice — the zod grammar at parse, a CHECK
constraint on the `events` table — because a turn-scoped row with no turn id is
a row no query can place.

**view context vs thread origin** — two answers to "which doc is this about",
and they are not interchangeable. A **view context**
(`@repo/domain/view-context`) rides ONE message: the path and the revision those
bytes hashed to, taken at submit and consumed by that turn's prompt. It is EPHEMERAL and it is a statement about the PAST — the screen the
message left from, which is what "this" and "here" in it refer to — so nothing
has to reconcile it when the user navigates away. A **thread origin**
(`threads.originDocPath`) is the DURABLE binding an action makes: the note it
was composed over, surviving renames, and the thing the panel's note-first
ordering resolves. A message can carry a view context into a thread with no
origin — a composer send with the note chip detached has none.

**lane** — a CLOUD word, not a local one: `"any" | "desktop"` on a synced
thread's metadata row (`@repo/api/cloud/sync/sync-schema`). It is what makes
the sync log double as a dispatch mailbox — a `desktop`-lane thread pokes the
desktop sockets, an `any`-lane one only bumps sync. There is no lane in the
local server; locally a thread is just a thread.

## "event" means four things

Four different layers all say "event", and only the first is durable product
state.

- **thread event** — the PERSISTED log entry: `ThreadEvent`
  (`@repo/domain/provider-event`, despite the file's name), one row in the
  `events` table, server-assigned `sequence` contiguous per thread. This is
  what a client replays and what syncs.
- **provider event** — the runtime's EMITTED grammar: what a provider adapter
  is allowed to produce (`@repo/agent-runtime/vocabulary/provider-event`). The two
  grammars are near-twins with the same file name and are not the same set —
  the runtime constructs its events and never parses them, and
  `apps/cli/src/server/agents/event-mapping.ts` is the one place that narrows onto
  the persisted grammar. A provider event with no persisted counterpart is
  logged and dropped, never invented into a divergent shape.
- **sync event** — the cloud's unit of transfer
  (`@repo/api/cloud/sync/sync-schema`, `syncEventInputSchema`). Its body is
  `z.json()` on purpose: the Worker merges, dedupes and orders these WITHOUT
  parsing them. A sync event carries a thread event; it is not one.
- **filesystem event** — what the vault watcher reports
  (`apps/cli/src/server/vault/watcher`). Related but distinct: `fileChange` is a
  thread event ITEM type, the agent's own report of what it wrote, which is
  what an agent commit stages.

The local realtime bus is deliberately NOT in this list. It carries **change
kinds** — `events-appended`, `content-changed`, `status-changed`
(`@repo/api/local/notifications`) — which are invalidation pings naming a
subscription target, never payloads. A client told "events-appended" refetches;
it is never handed the event.
