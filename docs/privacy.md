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
- **Device pairing records** — a name you chose per device, timestamps, and the
  SHA-256 hash of each device credential. The credential itself is answered
  once at pairing and never stored.
- **Thread events** — the append-only log of your agent conversations
  (messages, tool activity, status), pushed by each device to your account's
  own thread-sync Durable Object so your other devices can follow along. The
  cloud stores these as opaque JSON and fans them out; it does not interpret
  them.
- **Captures** — quick-capture text you post from a device, held in the same
  per-user object until one of your devices applies it to your daily note and
  acks, which deletes the row.
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
- **Telemetry about note content.** There is none.

## Retention

- Thread events and captures live in your Durable Object until you delete them
  or delete the account. Thread events are an append-only log — that is what
  makes multi-device merge trivial — so assume a synced conversation persists
  until account deletion.
- Device rows (including revoked ones) persist as the dashboard's audit trail
  until account deletion. Pairing codes live ten minutes and are swept.

## Account deletion

Deleting the account deletes the account's data, in this order, before the
account row itself goes:

1. Your thread-sync Durable Object is purged whole — every thread event, every
   capture, every open socket closed (`ThreadSyncDO.purge`, called from Better
   Auth's `beforeDelete` hook).
2. Every device and pairing row you own is deleted from D1.
3. Your email is dropped from the invite you redeemed (the code stays burned).

BEFORE, so a purge that fails aborts the deletion and leaves the account able
to ask again; every step is idempotent, so asking again resumes. What deletion
does NOT touch is your machine: the local vault and local databases are yours,
and a hosted git remote, if you configured one, is deleted with the account's
Artifacts repo.

## The honest edges

- Thread events are stored server-side unencrypted (the object's storage is
  Cloudflare-encrypted at rest, but this deployment can read it — there is no
  end-to-end encryption). Don't sync a conversation you wouldn't store in a
  hosted notes app.
- A revoked device stops at the next request — revocation cannot reach a
  response already in flight.
- `git push` to ANY remote is subject to that remote's own retention; a hosted
  Artifacts repo is deleted with the account, a GitHub remote is governed by
  GitHub.
