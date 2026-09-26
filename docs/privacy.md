# Privacy

inteligir is local-first: the product is a process on your machine, and your
vault is a git repository of markdown files on your disk. The cloud's job is
accounts, cross-device thread sync, quick capture, and the account's hosted
git remote. This page states exactly what that means — what leaves your
machine, what never does, how long the cloud keeps it, and how it dies.

## What leaves your machine

Everything below but the last four items lands in infrastructure scoped to
YOUR account — a Cloudflare D1 row keyed to your user, or your own per-user
Durable Object — never in anything shared across accounts.

- **Account data** — email, name, password hash, sessions (each with the IP
  address and user agent it signed in from) — in Cloudflare D1 (Better Auth).
- **Device records** — a name per device (that machine's hostname unless it was
  given another), timestamps (created, last seen, revoked) and the SHA-256 hash
  of each device credential. The credential itself is answered once, when the
  device signs in with your email and password or creates the account, and
  never stored. The password crosses the wire for that one request and is held
  nowhere on the device; the browser session that sign-in or sign-up would have
  created is deleted in the same request, so the device holds its credential
  and nothing else.

- **Thread events** — the append-only log of your agent conversations
  (messages, tool activity, status, and each thread's title, the path and
  frontmatter id of the note it was started over, the agent it runs on and
  whether you archived it),
  pushed by each device to your account's own thread-sync Durable Object so
  your other devices can follow along. The cloud stores these as opaque JSON
  and fans them out; it does not interpret them.
- **Requests from your phone to your computer's agent** — what you ask the
  agent on your phone (the text, the conversation it belongs to, and the note
  you asked from, with a fingerprint of the text you were looking at), and
  your answer when the agent asks your permission, held in the same per-user
  object until one of your computers picks it up. A request is handed to one
  computer at a time; if that computer stops mid-way the hold lapses after two
  minutes and another may take it. When a phone-started conversation needs
  your permission, the computer running it sends the question (the command or
  the change the agent wants to make, and why) to the same place for your
  phone to answer. A request waits until a computer picks it up or you cancel
  it; once a computer has answered it, or the question is settled, it is
  deleted a day later. A computer with Let my phone ask this Mac turned off in
  Settings never picks one up.
- **Captures** — quick-capture text you post from a device, held in the same
  per-user object until one of your devices applies it to your Inbox note and
  acknowledges it, which deletes the row. A capture is handed to one device at
  a time (a claim), and the row is deleted only by the device that held that
  claim. If that device dies mid-apply the claim lapses after five minutes and
  the capture is offered again — so a capture can be delivered twice and is
  never silently lost. The app deduplicates on the capture's id.
- **Your vault — ONLY if it has a git remote or you sign a device in.** Sync
  is `git push` to a remote you choose: one you set in Settings › Advanced or
  pin, or the one a folder you open already has, which it keeps syncing with.
  No remote and no device signed in, no vault bytes leave the machine; a
  folder with a remote of its own, or one iCloud Drive, Dropbox, Google Drive,
  OneDrive or Obsidian Sync already syncs, never goes to the hosted remote.
  The hosted remote is exactly that: a git
  host for your repo, per user, reachable only with a device credential from
  your own account. It is encrypted at rest by Cloudflare, but this
  deployment can read it — there is no end-to-end encryption; the trade is
  what lets your phone read and edit notes without holding a git client.
- **Your IP address, for throttling — the one row NOT tied to your account.**
  Signing a device in, redeeming an invite, and every Better Auth route but the
  session read count attempts per caller address in D1's `rate_limit` table:
  a row holds the address beside the route it counts, a count and a
  timestamp. Before sign-in the address is all the cloud knows about a
  caller, and a login with no throttle is a password oracle.
- **The update check — to GitHub, not this project's cloud.** The packaged
  desktop app asks GitHub's release feed whether a newer version exists 15
  seconds after launch and every 4 minutes after that. GitHub sees your IP
  address and the app's version, nothing about your vault or your account.
  Nothing downloads or installs without a click. `inteligir serve`, from a
  checkout or through `npx`, makes no such check.
- **The phone's update check — to Expo, not this project's cloud.** Each time
  the phone app starts it asks Expo's update service whether a newer version of
  its app code exists, downloads one in the background and runs it from the
  next start. Expo sees your IP address, the app's build and a random id the
  app keeps for that install, nothing about your vault or your account.
- **What your agent reads — to that agent's provider.** An action runs Claude
  Code or Codex on your machine, and the notes it reads to answer travel to
  the model provider that tool is set up for, under that provider's own terms,
  like any other use of the tool. Signing the agent in from the app runs that
  tool's own sign-in: your browser signs in with the provider directly, and the
  credential lands in the tool's own store on this Mac, never with the app.
  This deployment's cloud is not in either path.

## What never leaves

- **Your vault, by default — except what an agent reads.** Notes,
  attachments, frontmatter, the knowledge index — all local; this project's
  cloud never holds them unless you configure a remote or sign in. The one
  exception is an action: the notes the agent reads go to its provider (see
  above). Thread sync carries thread events, not note contents (except where
  you or the agent quoted a note INTO a conversation — a conversation is a
  thread event).
- **Your AI provider credentials.** The agent runs on your machine and talks
  to your provider from there; this deployment's cloud never sees or proxies
  those calls.
- **Your voice.** The app never opens the microphone and downloads no speech
  model. Dictation is your operating system's own (on a Mac, press fn twice),
  which types into the app like a keyboard; where that audio goes is the
  operating system's to say, under its own settings and terms.
- **Where a photo was taken.** The phone opens the camera or your photo
  library only when you add a photo to a note, and keeps a smaller copy of it,
  saved again without its location or any other camera details; only that
  copy reaches your vault.
- **The app's log.** The desktop app keeps what its local server prints in
  `logs/server.log` inside its data folder (at most 5 MB, plus one older
  file), whether or not Debug logging is on; with it on (Settings › Advanced),
  the log also records each file change, sync step and agent message by file
  name and id, never what a note says or a credential. Nothing reads or sends
  it: it leaves the machine only if you attach it to a report yourself.
- **Telemetry about note content.** There is none.

## Retention

- Thread events and captures live in your Durable Object until you delete them
  or delete the account. Thread events are an append-only log — that is what
  makes multi-device merge trivial — so assume a synced conversation persists
  until account deletion.
- A request from your phone, and a permission question sent to it, is deleted
  a day after a computer settles it. One still waiting stays until a computer
  picks it up, you cancel it, or you revoke the phone that sent it, which
  deletes every request of its no computer has picked up yet; revoking a
  computer settles every question it sent.
- Device rows (including revoked ones) persist as the dashboard's audit trail
  until account deletion.
- Throttling rows are keyed on an address, not an account, so account deletion
  cannot find them. Better Auth deletes every row whose timestamp is over a
  minute old whenever one of its own limits opens a fresh window, so a row
  outlives its minute only until the next such request from anyone; nothing
  sweeps the table on a timer.

## Account deletion

You delete the account in the app: Settings › Account › Delete account…, on
any Mac signed in to it. It asks for your password again, and the cloud checks
the password before it deletes anything, so this Mac's sign-in alone cannot end
the account. If you lost your Mac, sign in on any other and delete from there.
The Mac you delete from is signed out; every other device is refused at its
next request.

Deleting the account deletes the account's data, in this order, before the
account row itself goes:

1. **Every device row you own** is deleted from D1. This is first
   on purpose: while a device row lives its credential still works, so any
   later step could be undone by a request that arrives a moment after it.
2. **Your hosted vault repo** — created once a signed-in device first pushes —
   with the listing of its file names, sizes and content ids kept for your
   phone's reads. A never-pushed account wipes empty tables, so the step is
   idempotent either way.
3. **Your thread-sync Durable Object** is purged whole: every thread event,
   every capture, every request from your phone, every open socket closed. It
   is then tombstoned, so a request that authenticated microseconds before
   step 1 cannot rebuild what was just deleted; it is refused instead.
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
- Signing out on a device revokes it the same way, but only if the cloud hears
  the sign-out: a device that signs out offline forgets its credential while its
  row stays active, until you revoke it from Settings › Account on another Mac
  or from the dashboard. The desktop's Settings › Account says so until it
  restarts or signs in again.
- `git push` to ANY remote is subject to that remote's own retention; the
  hosted vault repo is deleted with the account, a GitHub remote is governed
  by GitHub.

## Every address the app talks to

Your account's cloud is one origin, `https://inteligir.com`, and every call the
app, the phone or the account pages make to it is one of these routes. Nothing
else under `/v1/` exists.

| Route                              | What it carries                                                                                                     | What authenticates it                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/v1/auth/sign-up`                 | Your email, name, password and invite code, once, to create the account.                                            | The invite code; attempts are throttled per caller address.         |
| `/v1/device/login`                 | Your email, password and this device's name, once; it answers the device's credential.                              | Your password; attempts are throttled per caller address.           |
| `/v1/device/sign-up`               | Your name, email, password, invite code and this device's name, once, to create the account.                        | The invite code; attempts are throttled per caller address.         |
| `/v1/device/sign-out`              | Nothing but the credential; the device it names is removed from your account.                                       | That device's credential.                                           |
| `/v1/device/list`                  | Your devices' names and when each was created, last seen and revoked, for the account pages and Settings › Account. | Your signed-in browser session, or a signed-in device's credential. |
| `/v1/device/revoke`                | The id of the device to revoke.                                                                                     | Your signed-in browser session, or a signed-in device's credential. |
| `/v1/account`                      | Your account's email and id, answered to a signed-in device.                                                        | The device's credential.                                            |
| `/v1/account/delete`               | Your password, once, to delete the account and everything this page says the cloud holds for it.                    | Your password and the device's credential; throttled per device.    |
| `/v1/sync/push`                    | Your conversations with the agent, as events, with each one's title, note, agent and archived state.                | The device's credential.                                            |
| `/v1/sync/pull`                    | The same events, written by your other devices.                                                                     | The device's credential.                                            |
| `/v1/sync/ws`                      | A live connection that says only that something changed; the content moves by push and pull.                        | The device's credential.                                            |
| `/v1/capture`                      | The text of a quick capture.                                                                                        | The device's credential.                                            |
| `/v1/sync/captures/claim`          | The captures waiting for a computer to add them to your Inbox note.                                                 | The device's credential.                                            |
| `/v1/sync/captures/ack`            | The ids of the captures that computer added.                                                                        | The device's credential and the claim it was handed.                |
| `/v1/sync/dispatch`                | What you ask your computer's agent from your phone, or your answer to its permission question.                      | The device's credential.                                            |
| `/v1/sync/dispatch/claim`          | The requests waiting for a computer to pick up, and the answers meant for that computer.                            | The device's credential.                                            |
| `/v1/sync/dispatch/ack`            | The ids of the requests that computer took, and why it turned one down.                                             | The device's credential and the claim it was handed.                |
| `/v1/sync/dispatch/status`         | Whether your requests are waiting, picked up or answered, and whether a computer is online.                         | The device's credential.                                            |
| `/v1/sync/dispatch/cancel`         | The id of a request you took back before a computer picked it up.                                                   | The device's credential.                                            |
| `/v1/sync/dispatch/approval`       | The command or change an agent wants your permission for, in a conversation your phone started.                     | The device's credential.                                            |
| `/v1/sync/dispatch/approval/close` | The id of a permission question that no longer needs your answer.                                                   | The device's credential.                                            |
| `/v1/sync/dispatch/approvals`      | The permission questions waiting for your answer.                                                                   | The device's credential.                                            |
| `/v1/vault/tree`                   | The names, sizes and content ids of the files in your hosted vault.                                                 | The device's credential, within a per-device budget.                |
| `/v1/vault/file`                   | One note's text from your hosted vault.                                                                             | The device's credential, within a per-device budget.                |
| `/v1/vault/files`                  | Up to 40 notes' text from your hosted vault, in one request.                                                        | The device's credential, within a per-device budget.                |
| `/v1/vault/asset`                  | One attachment from your hosted vault.                                                                              | The device's credential, within a per-device budget.                |
| `/v1/vault/commit`                 | Your phone's edits and photos; a note another device changed first answers its text and name.                       | The device's credential, within a per-device budget.                |
| `/v1/git/vault.git`                | Your vault and its history, sent up from and down to your computers.                                                | The device's credential, within a per-device budget.                |

Everything else the app reaches is someone else's:

- **GitHub's release feed**, for the update check described above.
- **The agent's provider** (Anthropic for Claude, OpenAI for ChatGPT). The
  agent runs on your Mac and sends what it reads to that provider, under your
  own plan with them.
- **That provider's sign-in page**, opened in your browser when you sign the
  agent in; the credential it gives back stays in the provider's own folder on
  your Mac.
- **The servers you connect the agent to**, each at the address you gave it,
  and their own sign-in pages when they ask for one.
- **Your own sync server**, if you set one up for a vault instead of your
  account's hosted vault.
