# Privacy

inteligir v3 is local-first: the product is a process on your machine, and your
vault is a git repository of markdown files on your disk. The cloud's job is
accounts, cross-device thread sync, quick capture, and (eventually) an optional
hosted git remote. This page states exactly what that means — what leaves your
machine, what never does, how long the cloud keeps it, and how it dies.

## What leaves your machine

Everything below lands in infrastructure scoped to YOUR account — a Cloudflare
D1 row keyed to your user, or your own per-user Durable Object — never in
anything shared across accounts.

- **Account data** — email, name, password hash, sessions — in Cloudflare D1
  (Better Auth).
- **Device records** — a name per device (that machine's hostname unless it was
  given another), timestamps (created, last seen, revoked) and the SHA-256 hash
  of each device credential. The credential itself is answered once at pairing
  and never stored.
- **Pairing codes** — one row per pairing you approve, holding the code IN
  PLAINTEXT (it is a ten-minute single-use token carried in a redirect, not a
  secret at rest), your user id, when it expires, whether it was consumed, and
  the device it created. Nothing ever shows it to you: your browser mints it on
  Approve and hands it straight to the app on your machine.

  What actually happens to a spent code, stated because the tidy version would
  be a lie: **nothing collects it on a timer.** An expired or consumed row is
  already unusable — redeem judges expiry in the same statement that consumes —
  but the row itself sits there until the next time YOU approve a pairing,
  which is when your own dead rows are swept. If you pair once and never again,
  that one row persists until you delete the account.

- **Thread events** — the append-only log of your agent conversations
  (messages, tool activity, status), pushed by each device to your account's
  own thread-sync Durable Object so your other devices can follow along. The
  cloud stores these as opaque JSON and fans them out; it does not interpret
  them.
- **Captures** — quick-capture text you post from a device, held in the same
  per-user object until one of your devices applies it to your daily note and
  acknowledges it, which deletes the row. A capture is handed to one device at
  a time (a claim), and the row is deleted only by the device that held that
  claim. If that device dies mid-apply the claim lapses after five minutes and
  the capture is offered again — so a capture can be delivered twice and is
  never silently lost. The app deduplicates on the capture's id.
- **Your vault — ONLY if you configure a git remote.** Sync is `git push` to a
  remote you choose. No remote configured, no vault bytes leave the machine.
  The optional hosted remote (Cloudflare Artifacts, feature-gated until beta
  access lands) is exactly that: a git host for your repo, per user, opted
  into by pairing it as your remote.

## What never leaves

- **Your vault, by default.** Notes, attachments, frontmatter, the knowledge
  index — all local. Thread sync carries thread events, not note contents
  (except where you or the agent quoted a note INTO a conversation — a
  conversation is a thread event).
- **Your AI provider credentials.** The agent runs on your machine and talks
  to your provider from there; this deployment's cloud never sees or proxies
  those calls.
- **Your voice.** Dictation is transcribed by a speech model running on this
  machine. Microphone audio goes from the page to the local server and no
  further — there is no speech API, no key, and nothing to opt out of. The one
  network request the feature ever makes is downloading the model itself, once,
  from Hugging Face when you turn it on; the file is checked against a checksum
  this build ships and deleted when you turn it off.
- **Telemetry about note content.** There is none.

## Retention

- Thread events and captures live in your Durable Object until you delete them
  or delete the account. Thread events are an append-only log — that is what
  makes multi-device merge trivial — so assume a synced conversation persists
  until account deletion.
- Device rows (including revoked ones) persist as the dashboard's audit trail
  until account deletion. Pairing-code rows are usable for ten minutes and are
  swept the next time you mint one — see the caveat above.

## Account deletion

Deleting the account deletes the account's data, in this order, before the
account row itself goes:

1. **Every device and pairing row you own** is deleted from D1. This is first
   on purpose: while a device row lives its credential still works, so any
   later step could be undone by a request that arrives a moment after it.
2. **Your hosted vault repo**, if this deployment hosts one for you. When it
   does not — the default today — nothing was ever created, so there is
   nothing to delete.
3. **Your thread-sync Durable Object** is purged whole: every thread event,
   every capture, every open socket closed. It is then tombstoned, so a
   request that authenticated microseconds before step 1 cannot rebuild what
   was just deleted; it is refused instead.
4. **Your email is dropped from the invite you redeemed** (the code stays
   burned).

All of it runs BEFORE the account row, so a step that fails aborts the deletion
and leaves the account able to ask again; every step is idempotent, so asking
again resumes. What deletion does NOT touch is your machine: the local vault
and local databases are yours. A git remote you configured yourself is yours to
delete.

## The honest edges

- Thread events are stored server-side unencrypted (the object's storage is
  Cloudflare-encrypted at rest, but this deployment can read it — there is no
  end-to-end encryption). Don't sync a conversation you wouldn't store in a
  hosted notes app.
- A revoked device stops at the next request, and its live connection is closed
  as part of the revoke — but revocation cannot reach a response already in
  flight.
- `git push` to ANY remote is subject to that remote's own retention; a hosted
  Artifacts repo is deleted with the account, a GitHub remote is governed by
  GitHub.
