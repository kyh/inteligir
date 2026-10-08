# CONTEXT.md — the domain glossary

What the words mean. `CLAUDE.md` § Decisions records **why a choice was made**;
this records **what a term names**, where it lives, and — the part worth
reading — the neighbouring concept it gets confused with.

Rules for this file: every entry points at the module that OWNS the concept
rather than restating its implementation, because the module's own header is the
detail and this is the map. An entry that cannot be checked against code does
not belong here.

---

## The agent

The words below are one chain and are constantly swapped for each other. Read
them together.

**thread** — the durable conversation, a row in this app's own SQLite
(`threads` in `@repo/db/schema`, id `thr_…`). It survives process restarts and
owns its title, status and `activeTurnId`. Everything the user can reopen lives
here.

**turn** — one request-to-settle exchange inside a thread. It names no table:
a turn exists only as the SCOPE its events share (`@repo/db/ids`, id `turn_…`),
and `threads.activeTurnId` is the one the current status describes — bound by
`run.started`, unbound by every settle.

**turn driver** — what runs a turn: the one seam a send goes through
(`TurnDriver` in `apps/cli/src/server/threads/turn-driver.ts`), handed the
host's turn id and reporting the turn's events back through a sink. This build
carries two: `auto`, which refuses every send as `PROVIDER_UNAVAILABLE`
because no agent runtime exists yet, and `scripted`, the in-process fake the
suites drive, which parks an **approval** when a turn asks `ask: <command>`
(`apps/cli/src/server/agents/agent-driver.ts`). Not the agent
itself: the rebuild watches the agents a developer already runs, and a driver
is only how a turn this app starts gets carried out.

**session** — the PROVIDER's own conversation, `{ providerId, providerThreadId }`
on the thread row, so a later turn could resume into it. Nothing in this build
binds one: the columns wait for the observer, which binds a thread to the
vendor session it watches. Only `providerId`, the harness, travels, in a
`thread/meta` row a log may state; another device never learns the session id.
Not to be confused with the auth **session** in `apps/web` — a signed-in
user's row in D1 — which shares only the word.

**scope** — how far up an event's meaning reaches: `{ kind: "thread" }` or
`{ kind: "turn", turnId }` (`@repo/domain/thread-event-scope`). Turn scope is
the default reading; each event type carries its own scope in the
`threadEventSchema` union, and the exceptions (`client/turn/requested`,
`provider/error`, and the thread's own facts `thread/meta` and
`thread/archived`) state their reason beside it, so an event that escapes turn
chronology has to justify it in writing and a consumer reads a turn event's
`turnId` without a null branch. The rule is enforced twice — the zod grammar at
parse, a CHECK constraint on the `events` table — because a turn-scoped row
with no turn id is a row no query can place.

**view context, thread origin, context path** — gone with the notes app: what
its threads said about the note they were about. A log written before the cut
may still carry them (`viewContext` and `contextPaths` on
`client/turn/requested`, `originDocPath` and `originNoteId` on `thread/meta`);
the grammar declares none of them, so a parse strips them as it strips any
undeclared field, and the `threads` and `queued_thread_messages` columns that
held them stay in the schema unread rather than cost a migration.

**dispatch** — a row in the account's dispatch inbox
(`@repo/contract/cloud/dispatch/dispatch-schema`), the one way a phone asks a
Mac anything. A `turn` dispatch asks for a turn on a thread, new or existing,
and any Mac may claim it; an `answer` dispatch answers an **approval** a Mac
opened there for a phone-started turn, and only that Mac may claim it. A
dispatch is not a thread event: once a Mac takes a turn in, its
`client/turn/requested` row (or, while the thread is busy, the queued message
waiting to become one) carries the `dispatchId`, and the log is the record
from then on — the phone's pending copy of the message, kept in its own
`dispatch_outbox`, gives way to that row (`apps/cli/src/server/cloud/dispatches.ts`).

## "event" means three things

Three different layers all say "event", and only the first is durable product
state.

- **thread event** — the PERSISTED log entry: `ThreadEvent`
  (`@repo/domain/provider-event`, despite the file's name), one row in the
  `events` table, server-assigned `sequence` contiguous per thread. This is
  what a client replays and what syncs.
- **provider event** — what a turn driver reports through its sink
  (`ProviderEventSink` in `apps/cli/src/server/threads/turn-driver.ts`): thread
  events not yet stored, which the ONE ingest transaction appends, projects
  and announces (`apps/cli/src/server/threads/service.ts`). A driver reports
  in the persisted grammar; there is no second one to map from.
- **sync event** — the cloud's unit of transfer
  (`@repo/contract/cloud/sync/sync-schema`, `syncEventInputSchema`). Its body is
  `z.json()` on purpose: the Worker merges, dedupes and orders these WITHOUT
  parsing them. A sync event carries a thread event; it is not one.

The local realtime bus is deliberately NOT in this list. It carries **change
kinds** — `events-appended`, `status-changed`, `sync-status-changed`
(`@repo/domain/change-kinds` declares them; `@repo/contract/local/notifications`
is the `/ws` frame grammar that carries them) — which are invalidation pings
naming a subscription target, never payloads. A client told "events-appended"
refetches; it is never handed the event.

## The words the user sees

Each word below stands for an engine concept with another name in code.
Reading a report or a screenshot means translating back.

**Sync** — the rail footer's state and its Sync now: the THREAD sync, the
account's merged log every action reaches other devices through
(`cloud.status`, `cloud.syncNow`; the pass is
`apps/cli/src/server/cloud/sync-pass.ts`), worded by `syncLabel` in
`apps/desktop/src/renderer/app/sidebar/sidebar.tsx`. "Only on this Mac" is no
account; "Sync paused" is a pass only Settings › Advanced can explain.

**Account** and **Devices** — Settings › Account: an inteligir account (Better
Auth, in `apps/web`) and this install's DEVICE CREDENTIAL, the one secret a Mac
or a phone keeps after signing in (`<dataDir>/device-credential`,
`apps/cli/src/server/cloud/credential-store.ts`). Devices lists the account's
credentials and revokes a lost one
(`apps/desktop/src/renderer/app/settings/account-section.tsx`); each sign-in
mints a new device, and this Mac leaves only by signing out.

**Advanced** — Settings › Advanced
(`apps/desktop/src/renderer/app/settings/advanced-section.tsx`), the one
surface that keeps the engine's raw words: the thread sync's raw state and last
error, this device's id, the data folder and the debug-logging switch. Every
other surface points here ("Sync details…") rather than quoting it.
