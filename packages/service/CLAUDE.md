# Decisions: @repo/service and the cloud

Accounts and sessions, `/v1`, each account's library cell, each item's live
note, the fill, the connector and the built-in agent: the cloud's code, which
`apps/web`'s Worker serves and deploys. It runs on workerd alone, with no DOM,
node or react import, and the model's modules take no `crypto` or `URL` global,
the clock, random bytes and fresh ids injected (`oxlint.config.ts`).

## Accounts and sessions

- **The account's devices are its sessions, in one list any of them reads and
  ends.** A lost phone goes from Settings › Account with no password, and Better
  Auth's own list routes would hand each session's token to the browser.
  `packages/service/src/auth/session-devices.ts`.
- **A device signs out through Better Auth's own `/api/auth/sign-out`, and no
  unreachable cloud holds that sign-out open.** The phone drops its copy first
  and keeps the session if the copy will not go; a tab, holding nothing, ends
  the session first. `apps/mobile/src/lib/compose-runtime.ts`.
- **An account is deleted from any signed-in device, the password asked again,
  through Better Auth's `deleteUser`** (owner decision: whoever lost their Mac
  deletes from any Mac). Its `beforeDelete` is the one purge path, and a session
  alone never deletes, since a stolen one could.
  `packages/service/src/auth/delete-account.ts`.
- **Better Auth's `baseURL` is derived per request from its origin, and sign-up
  is invite-gated by a Worker route in front of it.** A fixed fallback mints
  reset links at the wrong deployment; `POST /api/sign-up` claims the invite
  atomically. `packages/service/src/auth/invite.ts`.
- **Only Better Auth's own read slides a session, and a tab makes it on the
  hour.** A row and its cookie slide together or not at all, so the Worker's own
  reads pass `disableRefresh`. `packages/service/src/auth/auth.ts`.
- **Every device signs in with Better Auth's own session, and `/v1` reads it by
  the door the request came through** (owner decision: the extension rides the
  browser's sign-in). A credential of our own is a second secret, verifier and
  list; a sign-in past the twentieth ends the one used longest ago.
  `packages/service/src/wire/v1-principal.ts`.

## The wire

- **A `/v1` client ignores what it does not know, the Worker is held to exactly
  what it declares, and the wire breaks only behind the client build floor**
  (owner decision). Per-row versions keep every old shape; requests stay
  `z.strictObject`, since only the newest Worker reads them.
  `packages/contract/src/library/call-outcome.ts`.
- **Every install's request names its build, and the Worker refuses one below
  the floor** (owner decision). The session stays live, so the next build
  resumes signed in; a page the Worker served ships in its deploy and needs
  none. `packages/service/src/client-floor.ts`.
- **`/v1` is one oRPC wire, `/v1/rpc`, its refusals declared once.** REST beside
  RPC is two serializers and two error vocabularies; only a file's bytes and the
  sockets stay plain HTTP. `packages/service/src/wire/rpc-refusal.ts`.
- **A library call reaches its cell with the principal the Worker verified, and
  nothing the caller sent in its place.** The Worker drops the caller's
  principal, `authorization` and `cookie` headers, so the cell verifies no
  session. `packages/service/src/wire/v1-rpc.ts`.
- **Every page that calls `/v1` is one the Worker served, so it answers no
  CORS.** The extension reaches the site under its host permission, and an
  origin allowed to send `expo-origin` would hold the phone's door.
  `packages/service/src/wire/v1-principal.ts`.
- **The apps read what they show from the cell, through rows no tool carries.**
  An assistant reads through `items.list`, `items.read` and `search`, and a
  screen's listing would only fill its context.
  `packages/service/src/library/library-router.ts`.

## The library cell

- **The account's sockets are its library cell's, each tagged with the holder
  the Worker verified.** A `moved` frame is a hint and never rows, since a
  dropped frame would be a lost write, and a socket opens on a minute's ticket,
  never a bearer in the URL. `packages/service/src/library/cell-sockets.ts`.
- **Each account's library is one SQLite Durable Object, `LibraryDO`, reached
  only through `ctx.exports` under a name a verified credential or its own cell
  gives.** Naming an object creates it, so no namespace is bound; a retired
  class stays a `deleted` tombstone. `apps/web/cloudflare.config.ts`.
- **A library write changes fields alone, only on the bases it names, in one
  transaction.** Last write wins loses an edit unseen, and a whole-item base
  makes two devices always conflict. `packages/service/src/library/cell-writes.ts`.
- **A change set seals by the cell's one alarm, and Undo reaches back seven
  days** (owner decision). A timer per set dies with an eviction, and with no
  version history Undo needs only a set's before and after.
  `packages/service/src/library/change-sets.ts`.
- **Undo runs a change set's fields backwards three ways, and each note takes
  its turn back first.** Every later edit stays; Yjs's UndoManager lives in
  memory, which an eviction ends. `packages/service/src/library/cell-undo.ts`.
- **Each note's body is a live document in an object of its own, which the cell
  seeds and reads back** (owner decision). No keystroke goes through the
  account's one object; `NoteDO` pushes its projection on a debounced save.
  `packages/service/src/note/note-do.ts`.
- **A note's socket opens through its door on the account socket's ticket, and
  the cell says how.** A ticket per note is a second credential, and a mode read
  from the client's headers could write in Deleted.
  `packages/service/src/note/note-routes.ts`.
- **An edit by passages goes to the note by block id, outside any
  transaction.** A cold note's load calls back into the cell, and a base
  sequence would refuse the edit whenever anyone typed in the note.
  `packages/service/src/library/cell-edits.ts`.
- **An account's deletion runs in its cell, the tombstone first and the sessions
  last.** Each step is idempotent, so a failed one aborts and the retry runs on
  a session still live. `packages/service/src/library/account-purge.ts`.
- **A file row never names an object R2 no longer holds, and R2 keeps nothing
  the cell refused or nobody settled.** A refused upload is a stray the alarm
  deletes, so the 1 GiB cap bounds R2. `packages/service/src/library/cell-blobs.ts`.
- **The cell implements every library row once, over its engine and the markdown
  codec.** Each answer is parsed through its row's output schema, so a leaked
  column never ships; a `[[Title]]` two items share stays text.
  `packages/service/src/library/library-router.ts`.
- **A file's bytes are R2's, addressed by their sha, and R2 checks it.** One
  `keepBytes` reserves, puts and settles every upload, and R2 parses a read's
  range; a signed URL would log a credential.
  `packages/service/src/library/blob-routes.ts`.
- **A save of a url the library holds answers that item as it stands.** One url,
  one item: merging the save makes two writers of its tags, folder and note.
  `packages/service/src/library/cell-saves.ts`.
- **An import is a cell job run a batch at a time, its plan in rows.** An alarm
  has 30 s of CPU, so each run lands one batch and moves the cursor with it.
  `packages/service/src/library/cell-imports.ts`.
- **A file is let go once nothing names it or will.** An item, a change set or a
  running import's plan keeps it, so releasing by `refs` alone drops a file only
  a change set holds. `packages/service/src/library/change-set-prune.ts`.
- **Filing rules are the person's own words, and only the person writes them.**
  They reach the agent above anything a saved page says, so an import reads an
  `AGENTS.md` as a note. `packages/service/src/library/library-rules.ts`.
- **A cell query is drizzle's sync builder over the table its schema declares,
  and only the search and a JSON path are SQL text.** Raw SQL spells the schema
  again and reads its rows back through zod; `listChunks` and `insertChunks`
  hold a statement to a Durable Object's 100 bound parameters.
  `packages/service/src/library/cell-db.ts`.
- **An agent turn's undo in a note replays the turn's own Yjs updates, and flags
  what it takes with a block the turn added.** One merged update per set loses
  an edit made between two of the turn's. `packages/service/src/note/turn-log.ts`.
- **A note object's duties to its cell are one deadline, each duty keeping its
  own retry.** One shared retry let a landed duty clear or re-arm the other's.
  `packages/service/src/note/note-duty.ts`.
- **A note's standing is one value, and leaving full or Deleted reopens every
  socket.** A boolean per standing left devices read-only after a compaction.
  `packages/service/src/note/note-standing.ts`.
- **A cell job's payload is one schema per kind, parsed where its row is
  taken.** A row that no longer reads is dropped and logged, so no run fails on
  it again. `packages/service/src/library/cell-jobs.ts`.
- **The cell keeps its listing in memory, caught up by sequence, and builds it
  again as it wakes.** A build on every read costs about 245 ms at 10,000 items,
  measured. `packages/service/src/library/cell-listing.ts`.

## Fills

- **A saved link is read off the fill queue, asked for in the write that made it
  wait.** A send inside the write asks for a reading the write may roll back,
  and a page's seconds of CPU on the alarm hold every write.
  `packages/service/src/library/cell-fills.ts`.
- **The cloud's fetch is the platform's, each hop judged by how its address is
  spelled.** A Worker resolves no name, so `fetchPage` refuses a private
  spelling at once rather than after three vague retries.
  `packages/service/src/fill/page-fetch.ts`.
- **A reading lands only the article and the facts a fill owns, as its own change
  set, on an item still waiting for it.** Bases the consumer read would conflict
  with every save meanwhile. `packages/service/src/library/article-landing.ts`.
- **The cloud keeps a page's cover as the site served it, and each device draws
  its own thumbnail.** A decoded picture is four bytes a pixel in an isolate the
  reading already fills. `packages/service/src/fill/read-page.ts`.
- **A link the agent saves is read only once its turn seals** (owner decision).
  Reading it at once would hand the agent a web reader within its turn.
  `packages/service/src/library/cell-fills.ts`.

## Search

- **Stemming is a shadow of the indexed text, never a rewrite of it.** FTS5's
  `porter` stems the index, so a half-typed word's prefix stops matching.
  `packages/service/src/knowledge/search-query.ts`.

## The connector

- **The library's rows become the connector's tools in the Worker, by meta
  chained on the contract's own rows.** Meta in `@repo/contract` would bundle MCP
  and OpenAPI into every client. `packages/service/src/connector/library-tools.ts`.
- **The connector's OAuth is `@cloudflare/workers-oauth-provider`'s, on KV,
  named from one origin per deployment** (owner decision). A verifier of our own
  is a second to audit; a disconnected grant is a D1 row, since KV has no
  compare-and-swap. `packages/service/src/connector/connector-auth.ts`.
- **The consent page is the Worker's, at `/connect/authorize`, over the site's
  session.** It runs no script and binds its form to the account it named, since
  a browser can change accounts while it stays open.
  `packages/service/src/connector/consent-page.ts`.
- **The connector is served in the account's cell, a fresh server a request over
  one of two registrars, its principal an assistant's.** A session object per
  client is state nothing needs. `packages/service/src/connector/connector-server.ts`.

## The built-in agent

- **The built-in agent is our own loop, one `AgentThreadDO` a conversation,
  woken by the Agents SDK's lifecycle** (owner decision: the Agents SDK, Claude
  through AI Gateway). The SDK's own harnesses re-send a cut reply as a prefill
  or drop thinking blocks. `packages/service/src/agent/agent-thread.ts`.
- **A conversation's transcript is Claude's replies as returned, only ever
  appended to, and a cut call is sent again whole.** One changed byte before a
  thinking block is a 400. `packages/service/src/agent/thread-db.ts`.
- **The agent's tools are the library's procedures, run by its cell under a
  principal only `agentTool` mints.** The connector over HTTP needs a credential
  to mint and refresh. `packages/service/src/agent/agent-tools.ts`.
- **The built-in agent's results fit in 40,000 characters.** A result is
  replayed into every later call of its conversation.
  `packages/service/src/agent/agent-tools.ts`.
- **An approval waits on the person ten minutes in the thread's own rows, and a
  cancel denies before it stops.** A tool that waits in memory dies with an
  eviction. `packages/service/src/agent/thread-loop.ts`.
- **Every turn is counted before it starts, every step capped, and every reply
  booked once it lands** (owner decision: a daily allowance per account, the
  gateway's spend limit behind it). Reserving each call would guess Claude's
  bill. `packages/service/src/agent/agent-allowance.ts`.
- **A thread is the account's: its events are the cell's rows its object's
  outbox pushes** (owner decision: the phone asks the agent too). The Agents
  SDK's client socket is a second socket and auth beside the account's.
  `packages/service/src/agent/agent-turns.ts`.
- **Claude is reached through one AI Gateway per target, which holds the key**
  (owner decision). No key on the Worker, a spend limit per account, and a
  Worker with no gateway fails closed.
  `packages/service/src/agent/anthropic-client.ts`.
- **The local Worker, the e2e and the suites run the one thread path against a
  scripted Messages API.** It refuses what Sonnet 5.5 refuses and counts dropped
  thinking blocks, which every run expects to be none. `tools/e2e/src/fixtures.ts`.
- **A long conversation is compacted by the API at 50,000 tokens, and a deploy's
  definition is taken up between turns.** A resumed turn writes its prompt to
  the cache again, 60 cents of the day's dollar at 150,000.
  `packages/service/src/agent/thread-request.ts`.
- **Saving a link is the agent's one way out of the library, and the person sees
  the whole address before it goes.** A saved page the agent read can ask it to
  carry the person's words to a site. `packages/service/src/agent/library-agent.ts`.
- **No device draws a remote image, frame or media in an item.** The agent
  writes notes a saved page may steer, and a fetch on open is a request no person
  made. `tools/repo-guards/src/remote-media.test.ts`.
- **A conversation's drive is one value, and a purge is a cut, never a stop.** A
  flag per concern let a purged drive step again over tables being removed.
  `packages/service/src/agent/thread-drive.ts`.
- **A tool call is one union, moved by one function.** Reading the columns at
  each site lost the person's no on a stop.
  `packages/service/src/agent/tool-call.ts`.
- **A thread's status is what its open turn and queued sends say, written in one
  place.** Six writers choosing a status let it contradict the rows.
  `packages/service/src/agent/turn-rows.ts`.

## The program and its suites

- **The Worker's program has no DOM, so a dependency's types that reference it
  are mapped to a stub.** highlight.js's `lib="dom"` reference breaks Web
  Crypto's calls in the Worker. `packages/service/src/types/highlight-js.d.ts`.
- **The service's suites run inside workerd on the service's own Worker, never
  deployed.** Better Auth, D1 and the Durable Objects run as they deploy, with
  none of the site's SSR or fill consumers. `packages/service/vitest.config.ts`.
