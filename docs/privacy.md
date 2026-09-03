# Privacy

inteligir is local-first: the product is a process on your machine, and your
vault is a git repository of markdown files on your disk. The cloud's job is
accounts, cross-device thread sync, quick capture, and the account's hosted
git remote. This page states exactly what that means — what leaves your
machine, what never does, how long the cloud keeps it, and how it dies.

## What leaves your machine

Everything below lands in infrastructure scoped to YOUR account — a Cloudflare
D1 row keyed to your user, or your own per-user Durable Object — never in
anything shared across accounts.

- **Account data** — email, name, password hash, sessions — in Cloudflare D1
  (Better Auth).
- **Device records** — a name per device (that machine's hostname unless it was
  given another), timestamps (created, last seen, revoked) and the SHA-256 hash
  of each device credential. The credential itself is answered once, when the
  device signs in with your email and password, and never stored. The password
  crosses the wire for that one request and is held nowhere on the device; the
  browser session that sign-in would have created is deleted in the same
  request, so the device holds its credential and nothing else.

- **Thread events** — the append-only log of your agent conversations
  (messages, tool activity, status), pushed by each device to your account's
  own thread-sync Durable Object so your other devices can follow along. The
  cloud stores these as opaque JSON and fans them out; it does not interpret
  them.
- **Captures** — quick-capture text you post from a device, held in the same
  per-user object until one of your devices applies it to your Inbox note and
  acknowledges it, which deletes the row. A capture is handed to one device at
  a time (a claim), and the row is deleted only by the device that held that
  claim. If that device dies mid-apply the claim lapses after five minutes and
  the capture is offered again — so a capture can be delivered twice and is
  never silently lost. The app deduplicates on the capture's id.
- **Your vault — ONLY if you configure a git remote or sign a device in.** Sync
  is `git push` to a remote you choose. No remote configured and no device
  signed in, no vault bytes leave the machine. The hosted remote is exactly that: a git
  host for your repo, per user, reachable only with a device credential from
  your own account. It is encrypted at rest by Cloudflare, but this
  deployment can read it — there is no end-to-end encryption; the trade is
  what lets your phone read notes without holding a git client.

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
  from a pinned sherpa-onnx release on GitHub when you turn it on; the archive
  is checked against a checksum this build ships and deleted when you turn it
  off.
- **Telemetry about note content.** There is none.

## Retention

- Thread events and captures live in your Durable Object until you delete them
  or delete the account. Thread events are an append-only log — that is what
  makes multi-device merge trivial — so assume a synced conversation persists
  until account deletion.
- Device rows (including revoked ones) persist as the dashboard's audit trail
  until account deletion.

## Account deletion

Deleting the account deletes the account's data, in this order, before the
account row itself goes:

1. **Every device row you own** is deleted from D1. This is first
   on purpose: while a device row lives its credential still works, so any
   later step could be undone by a request that arrives a moment after it.
2. **Your hosted vault repo** — created once a signed-in device first pushes. A
   never-pushed account wipes empty tables, so the step is idempotent either
   way.
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
- `git push` to ANY remote is subject to that remote's own retention; the
  hosted vault repo is deleted with the account, a GitHub remote is governed
  by GitHub.
