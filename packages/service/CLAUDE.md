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
- **The auth door answers the six Better Auth routes a client calls, by method
  and path, and a plain 404 to every other.** A list of routes to shut leaves
  open the one a release adds. `packages/service/src/auth/auth-route.ts`.
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
- **Nothing inside a library write awaits anything but its transaction.** A
  lock held across a fetch, a file store or a model stalls every write of the
  account; that work runs after the commit.
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
- **Markdown written into a body reads its links in one round of three queries
  inside its write.** A query per link is a round trip each, and a title index
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
