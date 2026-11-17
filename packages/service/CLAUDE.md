# Decisions: @repo/service and the cloud

Accounts and sessions, `/v1`, each account's library cell, each item's live
note, the fill, the connector and the built-in agent: the cloud's code, which
`apps/web`'s Worker serves and deploys. It runs on workerd alone, with no DOM,
node or react import, and the model's modules take no `crypto` global, the
clock, random bytes and fresh ids injected (`oxlint.config.ts`).

## Accounts and sessions

- **The account's devices are its sessions, in one list any of them reads and
  ends.** A lost phone goes from Settings › Account with no password, and Better
  Auth's own list routes would hand each session's token to the browser.
  `packages/service/src/auth/session-devices.ts`.
- **An account is deleted from any signed-in device, the password asked again,
  through Better Auth's `deleteUser`** (owner decision: whoever lost their Mac
  deletes from any Mac). Its `beforeDelete` is the one purge path, and a session
  alone never deletes, since a stolen one could.
  `packages/service/src/auth/delete-account.ts`.
- **Better Auth's `baseURL` is derived per request from its origin, and sign-up
  is invite-gated by a Worker route in front of it.** A fixed fallback mints
  reset links at the wrong deployment; `POST /api/sign-up` claims the invite
  atomically. `packages/service/src/auth/invite.ts`.
- **The auth door answers the six Better Auth routes a client calls, by method
  and path, and a plain 404 to every other.** A list of routes to shut leaves
  open the one a release adds. `packages/service/src/auth/auth.ts`.
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
- **A `/v1` call or file is admitted once, by one function: the floor, the
  door, its session, then the session's budget.** A check per handler is an
  order each spells again and a new route forgets, and a call is refused as
  unsigned before anything reads what it asks.
  `packages/service/src/wire/v1-principal.ts`.
- **`/v1` is one oRPC wire, `/v1/rpc`, its refusals declared once, and a file's
  upload is refused in them too.** REST beside RPC is two serializers and two
  error vocabularies, and a status each client maps back to a code is a third;
  only a file's bytes and the sockets stay plain HTTP.
  `packages/service/src/wire/rpc-refusal.ts`.
- **A library call reaches its cell with the principal the Worker verified, an
  argument of the cell's own method beside the request.** A principal on a
  header rides beside headers the caller controls, so each must be dropped
  first; the request crosses without its `authorization` and `cookie`, and the
  cell verifies no session. `packages/service/src/library/library-do.ts`.
- **Every page that calls `/v1` is one the Worker served, so it answers no
  CORS.** The extension reaches the site under its host permission, and an
  origin allowed to send `expo-origin` would hold the phone's door.
  `packages/service/src/wire/v1-principal.ts`.
- **The apps read what they show from the cell, through rows no tool carries.**
  An assistant reads through `items.list`, `items.read` and `search`, and a
  screen's listing would only fill its context.
  `packages/service/src/library/library-router.ts`.

## The library cell

- **The account's sockets are its library cell's, each tagged with the session
  the Worker verified.** A `moved` frame is a hint and never rows, since a
  dropped frame would be a lost write, and a socket opens on a minute's ticket,
  never a bearer in the URL. `packages/service/src/library/cell-sockets.ts`.
- **Each account's library is one SQLite Durable Object, `LibraryDO`, reached
  only through `ctx.exports` under a name a verified credential or its own cell
  gives.** Naming an object creates it, so no namespace is bound; a retired
  class stays a `deleted` tombstone. `apps/web/cloudflare.config.ts`.
- **The cell is opened once a wake, and once more a run of its alarm, by the
  one `openCell` its object and its suites both call.** Opened per call it
  rebuilds its handle and every closure on each event, and a suite that wires
  its own cell drifts from the object's.
  `packages/service/src/library/open-cell.ts`.
- **A write settles itself: its transaction tells the sockets and sets the
  alarm in the turn it commits.** A follow-up each caller owes is one a new
  write forgets, and an alarm set after an await is lost with the isolate.
  `packages/service/src/library/library-engine.ts`.
- **The engine guards a transaction and holds no rule: an op is its `cell-*`
  module's, landed through `land`, `landApart` or `rows`.** A method per op is a
  catalogue every new op grows, and only `land`'s scope lands an item, in its
  turn's change set when the built-in agent made it.
  `packages/service/src/library/library-engine.ts`.
- **An alarm's run tells the sockets once, its writes' frames merged on a cell
  of its own.** Each job commits alone, so a frame a commit would wake every
  device once a job, and a flag on the wake's cell would hold a call's frame for
  the whole run. `packages/service/src/library/library-do.ts`.
- **A verb of the cell's is a function over an item's fields, landed in the
  transaction that read them; a base guards only what was computed away from
  it, a device's property op and a change set's way back.** A base over fields
  read lines earlier cannot fail, and ops built to meet it are a second
  spelling of the change. `packages/service/src/library/cell-writes.ts`.
- **A change set is one built-in agent turn's, sealed by the push that ends
  the turn, and Undo reaches back seven days** (owner decision). Undo takes
  back only the agent's turns, so a set for any other writer is history nobody
  reads. `packages/service/src/library/change-sets.ts`.
- **A change set keeps each item's way back, the guarded ops its landings
  compose, and Undo lands them once each note takes its turn back.** Two
  snapshots of an item take back an edit made between two of the set's writes;
  Yjs's UndoManager lives in memory, which an eviction ends.
  `packages/service/src/library/revert-change.ts`.
- **Undo names a thread and its turns, and a change set holds only what is left
  to take back.** A set's id on the wire has every device page and join them,
  and a set marked undone is a state the press another device already made has
  to be refused by. `packages/service/src/library/cell-undo.ts`.
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
- **A handler runs the engine through its call's context, which answers the
  value or throws the error its row declares.** A refusal thrown past the engine
  skips the one mapping, and a result unwrapped at each handler is a step one
  forgets. `packages/service/src/library/library-orpc.ts`.
- **A file's bytes are R2's, addressed by their sha, and R2 checks it.** One
  `keepBytes` reserves, puts and settles every upload, and R2 parses a read's
  range; a signed URL would log a credential.
  `packages/service/src/library/blob-routes.ts`.
- **A save of a url the library holds answers that item as it stands.** One url,
  one item: merging the save makes two writers of its tags, folder and note.
  `packages/service/src/library/cell-saves.ts`.
- **An import is read on the device, and the cell only settles and lands its
  batches, each item whole or not at all.** An alarm has 30 s of CPU and a zip
  in R2 is a second copy, so the device that holds the file reads it.
  `packages/service/src/library/cell-imports.ts`.
- **A sweep is the cell's job, a lot a transaction, over the items its scope
  listed as it was asked.** A landing costs 0.5 to 2 ms, measured, so one
  transaction over 50,000 items outlasts an invocation's 30 s with every other
  call held behind it, and the device that asks holds no id past its pages.
  `packages/service/src/library/cell-sweeps.ts`.
- **A file is let go once nothing names it, asked of the rows that name it.** An
  item or a change set keeps it, and a count kept beside those rows is a second
  spelling that can drift from them. `packages/service/src/library/cell-blobs.ts`.
- **Filing rules are the person's own words, and only the person writes them.**
  They reach the agent above anything a saved page says, so an import reads an
  `AGENTS.md` as a note. `packages/service/src/library/library-rules.ts`.
- **Every statement of the cell runs on one drizzle handle, its sync builder
  over the table its schema declares, and only the search's match and rank and
  a JSON path are fragments.** A second port spells the schema again and reads
  its rows back through zod; `listChunks` and `insertChunks` hold a statement to
  a Durable Object's 100 bound parameters.
  `packages/service/src/library/cell-db.ts`.
- **An agent turn's undo in a note replays the turn's own Yjs updates, and flags
  what it takes with a block the turn added.** One merged update per set loses
  an edit made between two of the turn's. `packages/service/src/note/turn-log.ts`.
- **A note owes its cell one thing, the versions of its body the cell has yet
  to land, and the first to land hands the seed over.** A confirm of the seed's
  own is a second duty, retry and column that says nothing the first projection
  does not. `packages/service/src/note/note-duty.ts`.
- **A note's standing is one value, open, full or gone, and leaving full
  reopens every socket.** A boolean per standing leaves devices read-only after
  a compaction. `packages/service/src/note/note-standing.ts`.
- **Whether an item is in Deleted is the cell's alone: the door asks it for
  every socket, and the landing that moves it reopens its note's sockets.** A
  copy in the note is one that an Undo's or an import's restore never reaches,
  so the item opens read-only for good.
  `packages/service/src/library/cell-landing.ts`.
- **A cell job's payload is one schema per kind, parsed where its row is
  taken.** A row that no longer reads is dropped and logged, so no run fails on
  it again. `packages/service/src/library/cell-jobs.ts`.
- **Every job is taken by one lease and run from one table: a due row is counted
  and put off before anything runs, and a kind is the schema's enum, held to a
  run by the table's type.** A claim per kind left a row its run neither dropped
  nor put off setting the alarm in the past, and a run the platform ended went
  uncounted. `packages/service/src/library/cell-alarm.ts`.
- **The cell keeps its listing in memory, caught up by sequence, and builds it
  again as it wakes.** A build on every read costs about 245 ms at 10,000 items,
  measured. `packages/service/src/library/cell-listing.ts`.
- **An agent's list, search, outline and summaries are the held listing's
  answers, as the rail's are.** A count or a tag set read again in SQL folds a
  tag's case its own way, so an outline disagrees with the tag filter beside
  it. `packages/service/src/library/cell-reads.ts`.

## Fills

- **A saved link is read off the fill queue, asked for in the write that made it
  wait and sent by the alarm alone.** A send inside the write asks for a reading
  the write may roll back, a second sender races the alarm for the row, and a
  page's seconds of CPU on the alarm hold every write.
  `packages/service/src/library/cell-fills.ts`.
- **The fill queue delivers one page a batch.** A larger batch waits five
  seconds to fill, and a page that kills its invocation spends a delivery of
  every message beside it. `apps/web/cloudflare.config.ts`.
- **The cloud's fetch is the platform's, each hop judged by how its address is
  spelled.** A Worker resolves no name and the platform opens none written as
  numbers, so `fetchPage` refuses a private name or a numbered address at once
  rather than after three vague retries.
  `packages/service/src/fill/page-fetch.ts`.
- **A reading lands only the article and the facts a fill owns, on an item still
  waiting for it.** Bases the consumer read would conflict with every save
  meanwhile. `packages/service/src/library/article-landing.ts`.
- **A reading of a link an agent's turn saved folds into that turn's change
  set.** A reading is no person's change, and Undo would keep the link as
  changed since the turn. `packages/service/src/library/change-sets.ts`.
- **The cloud keeps a page's cover as the site served it, and each device decodes
  it at the size it draws.** A decoded picture is four bytes a pixel in an isolate the
  reading already fills. `packages/service/src/fill/read-page.ts`.
- **A link the agent saves is read only once its turn seals** (owner decision).
  Reading it at once would hand the agent a web reader within its turn.
  `packages/service/src/library/cell-fills.ts`.

## Search

- **Stemming is a shadow of the indexed text, never a rewrite of it.** FTS5's
  `porter` stems the index, so a half-typed word's prefix stops matching.
  `packages/service/src/search/search-query.ts`.
- **A search ranks ids, and a passage is cut only for a row its page shows,
  around the match.** A cut for every candidate reads two hundred bodies a
  keystroke to show twenty, and a line cut from its start can leave the match
  out. `packages/service/src/search/search-hits.ts`.
- **The index ranks and keeps no text: a body's one copy is `body_texts`.** An
  FTS5 table that keeps its content stores each body twice more against the
  1 GiB, in a row that must fit 2 MB whole.
  `packages/service/src/search/search-index.ts`.

## The connector

- **The library's rows become the connector's tools in the Worker, by meta
  chained on the contract's own rows, under the names the contract's table
  holds.** Meta in `@repo/contract` would bundle MCP and OpenAPI into every
  client. `packages/service/src/connector/library-tools.ts`.
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
- **A connected assistant reads the dialect's spec by one tool, `read_guide`,
  the text the built-in agent's prompt holds, and the agent is handed no such
  tool.** A block spelled wrong lands as literal text with no error, and the
  server's instructions ride every conversation, their first 512 characters all
  ChatGPT shows. `packages/service/src/connector/library-tools.ts`.

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
- **An approval waits on the person ten minutes in the thread's own rows, its
  deadline on the call that waits, and a cancel denies before it stops.** A tool
  that waits in memory dies with an eviction, and a deadline kept as a job of
  its own is lost between two writes. `packages/service/src/agent/thread-loop.ts`.
- **A conversation has one job, its drive, timed at rest by what its rows wait
  on.** A job a wait is a second record of it, which every move must keep in
  step across an await. `packages/service/src/agent/thread-loop.ts`.
- **Every turn is counted before it starts and every step capped; the dollars
  are the gateway's spend limit alone, which ends the turn it refuses** (owner
  decision: a daily allowance per account, $5 a day per account behind it). A
  ledger of our own prices every reply a second time.
  `packages/service/src/agent/agent-allowance.ts`.
- **A thread is the account's: its events are the cell's rows its object's
  outbox pushes** (owner decision: the phone asks the agent too). The Agents
  SDK's client socket is a second socket and auth beside the account's.
  `packages/service/src/agent/agent-turns.ts`.
- **Claude is reached through one AI Gateway per target, which holds the key**
  (owner decision). No key on the Worker, a spend limit per account, and a
  Worker with no gateway fails closed.
  `packages/service/src/agent/anthropic-client.ts`.
- **The local Worker, the e2e and the suites run the one thread path against a
  scripted Messages API, which answers what that path sends and reads and no
  more.** It refuses what Sonnet 5.5 refuses and counts dropped thinking blocks,
  which every run expects to be none; a usage nothing reads is one constant.
  `tools/e2e/src/fixtures.ts`.
- **A long conversation is compacted by the API at 50,000 tokens, and a deploy's
  definition is taken up between turns.** A resumed turn writes its prompt to
  the cache again, 60 cents at 150,000.
  `packages/service/src/agent/thread-request.ts`.
- **The person's filing rules are part of the definition a turn is sent under,
  the system's last block.** A system message among the others is summarized by
  a compaction, and the fallback model takes none; an edit of them rewrites the
  conversation's cache once. `packages/service/src/agent/thread-request.ts`.
- **Saving a link is the agent's one way out of the library, and the person sees
  the whole address before it goes.** A saved page the agent read can ask it to
  carry the person's words to a site. `packages/service/src/agent/library-agent.ts`.
- **A call that asks is read through its row's own input before it waits, and
  one the row refuses is answered there.** The event carries what the call
  would do, so no card words the model's raw input and a malformed call asks
  nobody. `packages/service/src/agent/agent-tools.ts`.
- **No device draws a remote image, frame or media in an item.** The agent
  writes notes a saved page may steer, and a fetch on open is a request no person
  made. `packages/editor/src/drawing-policy.ts`.
- **A conversation's drive is one value, and a purge is a cut, never a stop.** A
  flag per concern lets a purged drive step again over tables being removed.
  `packages/service/src/agent/thread-drive.ts`.
- **A tool call is one union, moved by one function, and its row holds that
  union's kind, as a turn's row holds its one state.** A column a concern stores
  pairs no state means, and reading them at each site loses the person's no on a
  stop. `packages/service/src/agent/tool-call.ts`.
- **A model call keeps no journal: the transcript says what is sent next, and
  the turn's row counts the tries that failed.** A table of calls is one only
  the suites read, and hashing each request for it puts an await between a
  call's abort and its send. `packages/service/src/agent/thread-loop.ts`.
- **A step that throws spends the turn's tries, and a push this build cannot
  read ends its turn.** A row nothing can read would fail every 30 seconds with
  the turn shown running. `packages/service/src/agent/thread-loop.ts`.
- **A thread's status is what its open turn and queued sends say, written in one
  place.** Six writers choosing a status let it contradict the rows.
  `packages/service/src/agent/turn-rows.ts`.
- **The agent's prompt is its own instructions then the dialect's spec, files
  joined in the one order its module lists, the same bytes for every account.**
  An index of the sections in their own text is a second order to keep in step,
  and a byte of an account ends the one cached prefix.
  `packages/service/src/agent/agent-prompt.ts`.
- **The spec names a library tool, never a command or a path, and each example
  in it reads as what it shows.** The agent has no shell and no files, and an
  example the codec cannot hold teaches it to lose words; a construct lands in
  the editor's rule table first, then in the words.
  `packages/service/src/agent/dialect-examples.test.ts`.

## The program and its suites

- **The Worker's program has no DOM, so a dependency's types that reference it
  are mapped to a stub.** highlight.js's `lib="dom"` reference breaks Web
  Crypto's calls in the Worker. `packages/service/src/types/highlight-js.d.ts`.
- **The service's suites run inside workerd on the service's own Worker, never
  deployed.** Better Auth, D1 and the Durable Objects run as they deploy, with
  none of the site's SSR or fill consumers. `packages/service/vitest.config.ts`.
