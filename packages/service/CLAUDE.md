# Decisions: @repo/service and the cloud

The cloud's code, which `apps/web` serves on Node: the environment it reads,
accounts, `/v1` and the library. It imports no React and no DOM (`oxlint.config.ts`). Another area's
decisions port with its code from the tag `cloudflare-last`.

## The environment

- **Every key the cloud reads is one zod schema, each optional or defaulted.**
  A missing key turns its feature off instead of crashing boot, while a value
  that is there but wrong fails it: a flag takes only `true` or `false`, the
  build floor only a release version, `resend` only with its key and sender.
  `packages/service/src/env.ts`.
- **`turbo.json`'s `globalEnv` and `.env.example` name exactly the keys the
  schema parses.** turbo hands a task only the variables it lists, and the
  example is the one list a deployer reads, so a key added to one and not the
  others fails a suite. `packages/service/src/env.test.ts`.

## Accounts and sessions

- **The account's devices are its sessions, in one list any of them reads and
  ends.** A lost phone goes from Settings › Account with no password, and Better
  Auth's own list routes would hand each session's token to the browser; a
  sign-in past the twentieth ends the one used longest ago.
  `packages/service/src/auth/session-devices.ts`.
- **An account is deleted from any signed-in device, the password asked again,
  through Better Auth's `deleteUser`** (owner decision: whoever lost their Mac
  deletes from any Mac). Its rows go by cascade and its `beforeDelete` forgets
  the invite's redeemer; a session alone never deletes, since a stolen one could.
  `packages/service/src/auth/delete-account.ts`.
- **Sign-up is invite-gated by `POST /api/sign-up`, which claims the code in one
  update, forwards to a second Better Auth instance and releases the claim if
  the sign-up fails.** Better Auth reads `disableSignUp` per instance, so the
  public one refuses sign-up outright. `packages/service/src/auth/invite.ts`.
- **The auth door answers the Better Auth routes a client calls, by method and
  path, an assistant's five OAuth routes among them, and a plain 404 to every
  other.** A list of routes to shut leaves open the one a release adds.
  `packages/service/src/auth/auth-route.ts`.
- **Better Auth's `baseURL` is the deployment's one origin, `APP_URL` or
  Vercel's production or preview URL, never a request's host.** A reset link
  minted from a forged `Host` would carry its token to another site.
  `packages/service/src/app-url.ts`.
- **Only Better Auth's own read slides a session.** A row and its cookie slide
  together or not at all, so the app's own reads pass `disableRefresh`.
  `packages/service/src/auth/auth.ts`.
- **Every device signs in with Better Auth's own session** (owner decision: the
  extension rides the browser's sign-in, its cookie's signed value as a bearer).
  A credential of our own is a second secret, verifier and list.
  `packages/service/src/auth/auth.ts`.
- **The limiter counts in Postgres's `rate_limit`, and the app's own windows on
  that table never outlast Better Auth's 60 s.** In memory a count is per
  instance; Better Auth prunes a row older than its longest window, which would
  reset a longer one mid-count. `packages/service/src/rate-limit.ts`.
- **Each of the app's windows is one upsert that returns its count, keyed on the
  caller's address before sign-in and on what it holds after: its session, its
  account or its assistant's grant.** A read then a write lets concurrent
  calls read one count and all pass. `packages/service/src/rate-limit.ts`.
- **On Vercel the caller's address is `x-vercel-forwarded-for`'s.** The edge sets
  it, while a client can send any `x-forwarded-for` chain.
  `packages/service/src/auth/client-ip.ts`.
- **Mail goes from `EMAIL_FROM` through Resend only when `EMAIL_MODE=resend`;
  unset, a deployment logs it outside production and sends nothing in it.** A
  log in production would hold live reset links, and with mail off a reset is
  refused up front rather than promising a link. No sender is built in (owner
  decision pending). `packages/service/src/auth/send-email.ts`.

## The connector

- **An assistant connects on Better Auth's OAuth provider and cimd, PKCE
  required, registering by its metadata document or by itself; the person signs
  in and allows it on the site's `/connect/authorize`.** The provider is stock,
  and a consent page of the site's own reads the signed request on the server
  and can offer read-only. `packages/service/src/auth/oauth.ts`.
- **A token is opaque, `ito_`-prefixed, stored hashed and minted for
  `${APP_URL}/connector` alone, and each call reads its grant again: token,
  assistant and consent, its scopes those both hold.** A disconnect or a
  narrowed consent reaches a live token at once, and no token reaches another
  resource. `packages/service/src/auth/oauth-auth.ts`.
- **A token the provider bound to a key takes the DPoP scheme and a fresh
  proof; any other, Bearer.** Both metadata documents advertise DPoP, so an
  assistant that holds a key is served. `packages/service/src/mcp/connector-server.ts`.
- **Disconnecting deletes the consent and every token of that assistant, and a
  password reset disconnects every one.** Settings lists consents, never tokens,
  and a reset is the person taking the account back.
  `packages/service/src/auth/connected-assistants.ts`.
- **The tools are oRPC's `McpRegistrar` over the routed library, filtered to
  the rows tagged a tool and, for a read-only grant, to the reads.** A tool is
  added by tagging its row, and a grant is never offered a tool its row would
  refuse. `packages/service/src/mcp/connector-server.ts`.
- **`/connector` refuses a foreign Origin before anything, then a request with
  no valid token, then one not a POST, then the grant's budget spent, a batch
  and a body past Vercel's 4.5 MB.** One request is one call of the budget, and
  a browser page can't spend a person's token.
  `packages/service/src/mcp/connector-server.ts`.
- **The registration hour is Better Auth's longest window, so its prune of
  `rate_limit` waits an hour.** The app's own windows stay within 60 s, pruned
  only after they lapse. `packages/service/src/auth/oauth.ts`.
- **An assistant's metadata document is fetched through `PAGE_FETCH_RELAY_URL`
  when it is set off Vercel.** cimd's transport refuses every host a test can
  serve. `packages/service/src/auth/oauth.ts`.

## The wire

- **A `/v1` client ignores what it does not know, the app is held to exactly
  what it declares, and the wire breaks only behind the client build floor**
  (owner decision). Requests stay `z.strictObject`, since only the newest
  deployment reads them. `packages/contract/src/rpc/call-outcome.ts`.
- **Every install's request names its build, and `/v1` refuses one below
  `MIN_CLIENT_BUILD` with 426** (owner decision). The session stays live, so the
  next build resumes signed in; a page the deployment served ships in it and
  names none. `packages/service/src/rpc/admit.ts`.
- **A `/v1` call or file is admitted once, by one function, before anything
  reads its path or body: the floor, the door, its session, then that
  session's minute of 1,200 calls.** A check per handler is an order each
  spells again and a new route forgets, and the minute is a ceiling only a loop
  meets. `packages/service/src/rpc/admit.ts`.
- **`/v1` is one oRPC wire, `/v1/rpc`, and a refusal or a fault outside every
  row is answered in its protocol.** REST beside RPC is two serializers and two
  error vocabularies, and Next's own 500 is a body no link reads.
  `packages/service/src/rpc/rpc-refusal.ts`.
- **`/v1` answers no CORS: every page that calls it is the site's own.** The
  extension reaches the site under its host permission, and an origin allowed
  to send `expo-origin` would hold the phone's door.
  `packages/service/src/rpc/admit.ts`.
- **The router grows by area, and a suite names the contract's rows not served
  yet.** `os.router(v1Contract)` compiles only once every row is there; the list
  shrinks as each area lands, and goes with the last.
  `packages/service/src/rpc/unrouted.test.ts`.

## The library

- **Every write to an account's library is one transaction holding the
  account's `library_state` row, made by its first write.** It keeps every
  guarantee one object per account gave: writes of one account land in turn,
  its sequence has no gaps, and other accounts never wait.
  `packages/service/src/library/library-store.ts`.
- **Nothing inside a library write awaits anything but its transaction, but a
  file's keep.** A lock held across a fetch, a file store or a model stalls
  every write of the account; that work runs after the commit (§ Files).
  `packages/service/src/library/library-store.ts`.
- **A write waits 5 s for the account's lock, set inside its transaction, and
  is refused as busy past it.** Waiters hold pooled connections, so one
  account's queue would take them all and stall every account, and Supabase's
  pooler drops a connection's startup parameters.
  `packages/service/src/library/library-store.ts`.
- **A write takes the library's next sequence once, at its first stamping
  landing, and keeps its answer under its op id.** A write that lands nothing
  moves nothing, and a resend after a lost answer is told what landed.
  `packages/service/src/library/library-store.ts`.
- **A part of a write that may be refused alone is an `attempt`, a savepoint
  that takes back the sequence it took with it.** A refusal rolls back the
  part, and a sequence kept past its rollback stamps rows the head never
  reached. `packages/service/src/library/library-store.ts`.
- **A device learns what moved by `library.changes`: the head, and the ids
  stamped past the one it sends, up to 200 before it says "all".** Every write
  stamps the rows it touches and a purge keeps the id at its sequence, so one
  indexed read per table answers it, with no socket held per device.
  `packages/service/src/library/library-changes.ts`.
- **The library's rows split into a reading module and a writing one, merged
  by the router where both route under `items`.** Reads and writes land apart,
  and neither side edits the other's file.
  `packages/service/src/rpc/library-router.ts`.
- **Every library row is built on `reading` or `writing`, whose middleware
  resolves the caller from its door's principal before the row reads its
  input, and refuses every write to a grant that only reads.** A check per
  handler is one a new row forgets, and a call never names its own account.
  `packages/service/src/library/library-access.ts`.
- **A write's refusal is thrown inside it, kept as a value at the
  transaction's edge, and thrown again by `answer` as the error its row
  declares.** One mapping holds every refusal's wire spelling, and a refusal
  that escaped the store would reach the client as a fault.
  `packages/service/src/library/library-access.ts`.
- **A landing checks every rule before it writes a row: fields and body within
  their caps, one live item per url, only files the library holds.** A refusal
  then has nothing of the item to roll back, so a bulk write can leave one item
  and land the rest. `packages/service/src/library/library-landing.ts`.
- **A write reads the account's folders once and lands its ops on that copy.**
  The contract's folder rules read synchronously, and a tree of names is small
  beside the item rows a write reads. `packages/service/src/library/library-folders.ts`.
- **A link saved to read later lands unread and asks for its page in the same
  write, as a `fill` row of the job table due at once, whoever saved it.** A
  reading is never asked by a write that rolled back nor lost by one that
  landed, a save calls no model, and the built-in agent reads the web itself, so
  its turn holds nothing back. `packages/service/src/library/library-fills.ts`.
- **Items one write makes land together, a statement a table, and a sweep or
  an import is set statements under the one lock.** One item's landing costs
  25–30 round trips from the function's region, so a landing per item holds
  the account's lock for minutes at a library's scale.
  `packages/service/src/library/library-landing.ts`.
- **An id list goes to Postgres as one array parameter, never spread.** drizzle
  spreads an array into a parameter each, and a sweep of 50,000 items passes
  Postgres's 65,535. `packages/service/src/library/set-sql.ts`.
- **A change of tags over 1,000 items goes to `sweep` jobs of 1,000, each a
  write of its own; every other sweep lands in its call.** Deriving tags and
  search rows costs about 1 s a 1,000 under the lock; 5,000 took 4-5 s with
  the search indexes' fastupdate off, at the 5 s wait past which every other
  write of the account is refused.
  `packages/service/src/library/library-sweeps.ts`.
- **A restore of many items brings back, of those at one address, only the one
  deleted last, and none a live item holds.** Two at one address each pass a
  check against the statement's snapshot, and the second fails it whole on
  `item_one_url`. `packages/service/src/library/library-items.ts`.
- **Only the built-in agent's writes keep a change set, one a turn, made by its
  first landing and sealed by the turn's end; a sweep or an import keeps none.**
  Undo reaches only the agent's turns, and the apps alone ask a sweep.
  `packages/service/src/library/library-change-sets.ts`.
- **A set's entry keeps an item's fields as guarded ops back and its body as it
  stood before the turn, with the versions before and after it; Undo lands an
  item whole or not at all.** A body written since keeps the item, named,
  rather than a merge of two writers' blocks, and turns undone together chain
  by those versions. `packages/service/src/library/revert-change.ts`.
- **Housekeeping prunes change sets and op answers inside its own
  transaction, skipping an account a write holds.** It locks each account's
  row as a write does, so a prune never races an Undo, and a busy account
  waits for the next run. `packages/service/src/library/library-change-sets.ts`.
- **Only a new item is refused past the account's cap, which counts the sum of
  its files' and bodies' rows.** A person never loses a word mid-note and a full
  library can still be tidied; fields and the search rows are small beside them.
  `packages/service/src/library/library-quota.ts`.
- **Markdown written into a body reads its links in one round of three
  queries.** A query per link is a round trip each, and a title index
  of the whole library reads every item to name a few.
  `packages/service/src/library/library-codec.ts`.
- **A file is let go a day after its last name went, asked of the rows that
  name it: an item's `item_file`, a change set's `change_set_file`.** Every
  name added or dropped moves `touched_at`; a count kept beside those rows is a
  second spelling that drifts from them. `packages/service/src/files/file-names.ts`.
- **A read of more than one query is one read-only, repeatable-read
  transaction.** A page and its counts, or a hit and its passage, then read one
  library. `packages/service/src/library/library-listing.ts`.
- **The listing is SQL held to the library model's by a seeded parity suite,
  its ids and titles ordered `collate "C"`.** The fake cell answers every
  client's suites by the model, and the database's collation orders case and
  accents apart from it. `packages/service/src/library/library-parity.test.ts`.

## Bodies

- **A body is written whole over the version its writer read, compared and
  written under the account's lock.** The lock already orders the account's
  writes, so the compare needs no guard of its own; a body written since
  answers stale for the device to merge, and a resend of the blocks it holds
  answers saved. `packages/service/src/body/write-body.ts`.
- **An agent's edit is made outside any write and written over the version it
  read; a save landing meanwhile makes it again once, and past that it is
  refused as busy.** The codec and an editor over a long note would hold the
  lock every other write of the account waits on.
  `packages/service/src/body/edit-body.ts`.
- **A body holds 1 MiB of blocks' JSON.** Every save writes the whole body and
  derives its search row again, which past it holds a save over a second on a
  Vercel function. `packages/contract/src/library/library-wire.ts`.

## Files

- **A file's bytes go from the device straight to the file store, between
  `library.files.reserve` and `library.files.settle`.** A function's body caps
  at 4.5 MB, and the store takes one PUT up to the 100 MB a file may be.
  `packages/service/src/files/file-landing.ts`.
- **The store is a port: Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, a
  folder at `FILE_STORE_DIR` otherwise, and none on Vercel without the token.**
  Development and the suites need no cloud account, and a deployment never
  writes to a function's disk. `packages/service/src/files/file-store-of.ts`.
- **One contract suite holds both stores, the folder on every run and Blob only
  on a run given its key, which reaches no other suite.** CI holds no secret,
  and every other suite reads the folder's own upload route.
  `packages/service/src/files/file-store.contract.test.ts`.
- **An upload is named by a sealed id, its sha, size, type and nonce under an
  HMAC, with no expiry of its own.** Settle trusts nothing a device sends back,
  and an object no settle kept expires in the store a day on, which bounds the
  id. `packages/service/src/files/upload-seal.ts`.
- **Settle hashes what the store holds before it keeps it, and removes every
  object it does not keep.** A device's sha is a claim, and a copy left behind
  is bytes nobody's quota counts. `packages/service/src/files/file-landing.ts`.
- **A file's keep runs inside the write that lands its row, the one store call
  under the lock.** Kept after the commit, a failed keep leaves a row naming
  bytes the store then lets expire; a keep is one call on the object's metadata.
  `packages/service/src/files/file-landing.ts`.
- **A write for an account whose user row is gone is refused `GONE` by the
  lock.** A settle arriving after a delete would otherwise make a library for
  nobody. `packages/service/src/library/library-store.ts`.
- **A deleted account's files are removed in `beforeDelete`, before its user
  row.** A failed removal leaves an account to delete again, and once the row
  is gone nothing names the prefix. `packages/service/src/files/purge-files.ts`.
- **`/v1/blobs/<sha>` answers HEAD, preconditions and ranges from the file's
  row, and reads the store only for a body.** A media loader's probes and a
  device's revalidations then cost no store read.
  `packages/service/src/files/file-read-route.ts`.

## The built-in agent

- **The agent is eve's, served by the deployment under `/eve/v1`, and only the
  app calls it, with a token minted for that call's thread and session.** A
  page can't reach a session, and `proxy.ts` can't gate eve's routes, so the
  channel admits each request itself; `/eve/v1/health` is public.
  `packages/service/src/agent/eve-admission.ts`.
- **A thread is ours, over one numbered eve session at a time: one that ended
  or idled 7 days goes on in the next, created under `<thread>.<number>`.** eve
  ends a session on a failed model call, and a create retried under its
  operation id answers the same session. `packages/service/src/agent/agent-sessions.ts`.
- **The record hook keeps what eve did as rows keyed by where eve recorded it,
  and a turn by its eve turn id in its session.** eve delivers a hook at least
  once and numbers turns per session, so a replay writes nothing and session
  2's `turn_0` is a new turn. `packages/service/src/agent/eve-agent.ts`.
- **The agent's tools are the library's rows tagged `mcp.tool` that the router
  serves, each write's op id hashed from its eve session and call.** A list
  kept by hand drifts from what the connector offers, and a step eve reruns
  lands its write once. `packages/service/src/agent/agent-tools.ts`.
- **The mock model answers only with `AGENT_MOCK_MODEL` off Vercel, read at
  each model call.** A deployment that boots with it is refused, and a build
  never bakes it in. `packages/service/src/agent/availability.ts`.
- **A thread streams to a device as one event iterator: the rows the record
  hook kept, `caughtUp`, then its eve session followed live, deduped by
  position.** An event's id is its `<session>:<line>:<index>`, so a reconnect
  by `lastEventId` misses and repeats nothing whichever side holds it; a draft
  is never kept, so it shows only from where its stream picked up.
  `packages/service/src/agent/relay.ts`.
- **The stream has its own route, cut at 280 s inside its 300 s
  `maxDuration`.** A cut reads as a dropped connection, so the device
  reconnects where it left off; every other call keeps `/v1/rpc`'s default
  duration. `apps/web/src/app/v1/rpc/library/agent/events/route.ts`.
- **A message sent mid-turn joins it, and Stop is eve's cancel.** eve steers a
  running turn by its own caller, so a turn holds every message sent while it
  ran and ends `cancelled` when stopped. `packages/service/src/agent/agent-sessions.ts`.
- **The day's limits are counted from the account's ledger, `agent_usage`,
  each spend keyed where eve recorded it: a turn booked, a model call's tokens
  priced at Sonnet 5.5's rates, a web search at a cent.** The gateway runs
  Anthropic on the team's own key, so eve reports no cost, and a ledger off the
  thread gives nothing back when a conversation is deleted.
  `packages/service/src/agent/agent-limits.ts`.
- **A limit stops a turn by stamping `agent_turn.stop_reason`, then eve's
  cancel; a turn is booked under the account's lock as it starts, and a send
  that would start one is refused first.** eve settles a hook's cancel with no
  cause, and two turns starting at once must not both take the day's last.
  `packages/service/src/agent/eve-agent.ts`.
- **A send's op id answers its resend from `op_answer`, before the limits.**
  A resend after the day ran out would otherwise refuse a message eve already
  took. `packages/service/src/agent/agent-sessions.ts`.
- **The agent's cron settles a turn open an hour as failed and seals every set
  whose turn no longer runs.** A settle eve recorded but couldn't deliver, or a
  landing after one, leaves a set Undo and the prune never reach.
  `packages/service/src/agent/eve-agent.ts`.
- **A deleted thread is a tombstone at once, purged after the response, and
  by the agent's cron every 15 minutes where that failed.** Ending its eve
  session can fail, and a row gone first would leave the session running for
  nobody; the channel refuses the session's every route but stop once its
  thread is deleted. `packages/service/src/agent/agent-sessions.ts`.
- **A cron route answers only Vercel Cron's bearer, and none with no
  `CRON_SECRET`.** Its address is public. `packages/service/src/cron.ts`.

## Search

- **An item's search vector is a literal built from our own tokenizer, every
  word beside its stem as `~stem`.** One tokenizer keeps the vector, a query
  and a passage's matches on one word; a prefix typed against stems dies where
  the suffix begins, and a stem written only where it differs misses an item
  holding the root. `packages/service/src/search/search-vector.ts`.
- **The vector fills its fields in order under Postgres's own cost, and stops
  at the first word past it.** A long body keeps its opening, and the literal
  tier still reaches its tail. `packages/service/src/search/search-vector.ts`.
- **A query is a tsquery literal from the same tokenizer, each term its word,
  a prefix while typed, or its stem's shadow, every word asked before any.**
  `to_tsquery` and `websearch_to_tsquery` stem with Postgres's stemmer, whose
  lexemes the vector never wrote. `packages/service/src/search/search-sql.ts`.
- **A needle of 3+ printable ASCII characters is also matched as written, by
  `LIKE` on the trigram index, at most 200 candidates.** Code and punctuation
  the tokenizer drops still find their item, and a shorter needle has no
  trigram to narrow by. `packages/service/src/search/search-sql.ts`.
- **A hit's passage is cut in JS from its text, not by `ts_headline`.**
  `ts_headline` reparses with Postgres's parser and marks words our tokenizer
  never matched. `packages/service/src/search/search-excerpt.ts`.
