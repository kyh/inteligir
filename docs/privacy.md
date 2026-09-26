# Privacy

inteligir is local-first: your notes are markdown files in a folder you choose
on your Mac, with their history kept beside them. The app and its search run on
that Mac, and so does the agent, which talks to its provider from there. An
account is optional. Signed in, a small cloud carries your conversations with
the agent between your devices, your quick captures and your phone's requests,
and keeps a hosted copy of your vault for your phone and your other Macs. This
page states exactly what that means — what leaves your machine, what never
does, what your phone keeps, how long the cloud keeps it, and how it dies.

## What leaves your machine

### To this project's cloud, once you sign in

Without an account the app sends this project's cloud nothing. Every item below
but the last two lands in infrastructure scoped to YOUR account — a Cloudflare
D1 row keyed to your user, your own per-user Durable Objects, or storage named
for your vault alone — never in anything shared across accounts.

- **Account data** — your name, email, password hash and sessions (each with
  the IP address and user agent it signed in from), in Cloudflare D1 (Better
  Auth), and the invite code you redeemed with your email beside it. You create
  the account in the app, or on the website: your name, email, password and
  invite code cross the wire over HTTPS once, and the same request signs that
  Mac in. A password reset emails you a link through Cloudflare's own email
  sending, and the link's token waits in D1 (see Retention).
- **Device records** — a name per device (the name Finder shows for a Mac, the
  name a phone reports for itself), timestamps (created, last seen, revoked)
  and the SHA-256 hash of each device credential. The credential itself is
  answered once, when the device signs in with your email and password or
  creates the account, and never stored. The password crosses the wire for that
  one request and is held nowhere on the device; the browser session that
  sign-in or sign-up would have created is deleted in the same request, so the
  device holds its credential and nothing else.
- **Thread events** — the append-only log of your conversations with the agent:
  your messages, its replies, what its tools did (the text of notes and files it
  read and the changes it made to them, as its tools reported them), its status,
  and each conversation's title, the path and frontmatter id of the note it was
  started over, the agent it runs on and whether you archived it. Each Mac
  pushes them to your account's own thread-sync Durable Object so your other
  devices can follow along, and your phone keeps a copy. The cloud stores these
  as opaque JSON and fans them out; it does not interpret them.
- **Requests from your phone to your Mac's agent** — what you ask the agent on
  your phone (the text, the conversation it belongs to, and the note you asked
  from, with a fingerprint of the text you were looking at), and your answer
  when the agent asks your permission, held in the same per-user object until
  one of your Macs picks it up. The first Mac to pick a request up runs it
  there, on that Mac's own Claude or ChatGPT plan, so what the agent reads for
  it goes to that provider as if you had asked on the Mac; the conversation
  then syncs back as thread events. A request is handed to one Mac at a time;
  if that Mac stops mid-way the hold lapses after two minutes and another may
  take it. When a phone-started conversation needs your permission,
  the Mac running it sends the question (the command or the change the agent
  wants to make, and why) to the same place for your phone to answer. A Mac
  with Let my phone ask this Mac turned off in Settings never picks one up.
- **Captures** — quick-capture text you post from a device, held in the same
  per-user object until one of your Macs applies it to your Inbox note and
  acknowledges it, which deletes the row. A capture is handed to one Mac at a
  time (a claim), and the row is deleted only by the Mac that held that claim.
  If that Mac dies mid-apply the claim lapses after five minutes and the capture
  is offered again — so a capture can be delivered twice and is never silently
  lost. The app deduplicates on the capture's id.
- **Your vault, in your account's hosted vault — only for a vault nothing else
  syncs.** Signed in, each Mac sends its vault — notes, attachments, comments
  and every earlier version, each change named for the device that saved it and
  an agent's changes for the conversation that made them — to one hosted copy
  per account, which your other Macs and your phone read from. The cloud also
  WRITES it: your phone's edits, new notes, renames, deletions, comments and
  photos are saved into it by this project's cloud as changes named for the
  phone, and every Mac takes them in at its next sync. The hosted vault is
  reachable only with a device credential from your own account, and holds
  about 1 GB, history included: a full one still opens and downloads
  everywhere, but takes no new changes, which wait on your Macs and your phone
  until it has room. It is encrypted at rest by Cloudflare, but this deployment
  can read it — there is no end-to-end encryption; the trade is what lets your
  phone read and edit notes without holding their history. A vault with a git
  server of its own (below), or a folder iCloud Drive, Dropbox, Google Drive,
  OneDrive or Obsidian Sync already syncs, never goes to the hosted vault.
- **Your IP address, for throttling — the one row NOT tied to your account.**
  Signing a device in, creating an account, redeeming an invite, and every
  Better Auth route but the session read count attempts per caller address in
  D1's `rate_limit` table: a row holds the address beside the route it counts, a
  count and a timestamp. Before sign-in the address is all the cloud knows about
  a caller, and a login with no throttle is a password oracle. Once signed in, a
  device's reads and writes of the hosted vault, and its attempts to delete the
  account, are counted the same way under the device's id, never an address.
- **A log of each request, kept by Cloudflare.** Cloudflare, which runs this
  project's cloud, logs each request the cloud answers — the address asked for
  (when your phone opens a note or an attachment, that includes the file's
  name), the answer's status and the time — and keeps that log for up to seven
  days, for this deployment's operator to diagnose failures with; about one
  request in a hundred is traced in more detail. The cloud's own error lines
  name a route, never a file.

### Elsewhere, never through this project's cloud

- **Your vault, to a git server of your own — if it has one.** A folder you open
  that already syncs to a server of its own keeps syncing there, and you can
  choose one in Settings › Advanced › Sync with. Your notes, attachments,
  comments and every earlier version, each change named for the device that
  saved it, go to that server under its own terms and retention.
- **What your agent reads — to that agent's provider.** The agent is Claude's or
  ChatGPT's own agent program, shipped inside the app and run on your Mac on
  your own Claude or ChatGPT plan. What you ask it, the name of the note you were
  looking at, and the notes and files it reads to answer — in your vault, in a
  folder you connected under Settings, or anywhere else on this Mac it is
  allowed to open — travel from your Mac to that provider (Anthropic or OpenAI)
  under the provider's own terms, as they would in the provider's own app. That
  program also reports to its maker whatever it reports when you run it
  yourself.
- **Signing the agent in — with the provider, directly.** Signing in from the
  app runs the provider's own sign-in: your browser signs in with Anthropic or
  OpenAI directly, and when it cannot hand the result back on its own, you paste
  the code it shows into the app, which passes it straight to the provider's
  program on this Mac. The credential lands in that program's own store (see
  What never leaves).
- **Connectors — to the services you connect.** A connector is added to the
  default agent's own settings in your home folder: the same list Claude Code or
  Codex reads everywhere on this Mac, so it reaches that agent outside the app
  too. When a connector asks you to sign in, the agent's program runs that
  sign-in in your browser and keeps it; the app keeps no connector's secret.
  What the agent sends a connector and gets back travels between your Mac and
  that service, and on to the agent's provider as part of the conversation.
- **The update check — to GitHub.** The packaged desktop app asks GitHub's
  release feed whether a newer version exists 15 seconds after launch and every
  4 minutes after that. GitHub sees your IP address and the app's version,
  nothing about your vault or your account. Nothing downloads or installs
  without a click. `inteligir serve`, from a checkout or through `npx`, makes no
  such check.
- **The phone's update check — to Expo.** Each time the phone app starts it asks
  Expo's update service whether a newer version of its app code exists,
  downloads one in the background and runs it from the next start. Expo sees
  your IP address, the app's build and a random id the app keeps for that
  install, nothing about your vault or your account.

## What never leaves

- **Your vault, by default.** Notes, attachments, their history and the search
  index all live on your Mac, and this project's cloud holds none of it unless
  you sign in on a vault nothing else syncs (above). The exceptions are what the
  agent reads, which goes to its provider, and your conversations: thread sync
  carries each one whole, and a conversation holds what the agent read and
  changed in it.
- **The agent's sign-in.** The credential stays in the provider's own store on
  this Mac — for Claude, a folder in your home folder and the macOS Keychain;
  for ChatGPT, Codex's folder in your home folder — the same store Claude Code
  or Codex uses, so signing in or out in the app does so there too. The app asks
  the provider's program whether you are signed in, and to which account and
  plan, to show you in Settings; it never reads, copies or sends the credential,
  and this project's cloud never sees or carries a call to the model.
- **Your voice.** Neither the Mac app nor the phone app ever opens the
  microphone. Dictation is your operating system's own — on a Mac, press fn
  twice; on the phone, the keyboard's microphone key — which types into the app
  like a keyboard; where that audio goes is Apple's to say, under its own
  settings and terms.
- **Where a phone photo was taken.** The phone opens the camera only when you
  take a photo for a note, and from your library it receives only the photo you
  pick. It keeps a copy at most 2048 pixels on its long side, saved again as a
  JPEG without its location or any other camera details and named for when you
  added it; only that copy reaches your vault.
- **Anything a note points at on the web.** Opening a note loads nothing from
  the web, on the Mac or the phone: an image or embed at a web address is not
  fetched, so nobody learns you opened it. A link opens in your browser only
  when you follow it.
- **The app's log.** The desktop app keeps what its local server prints in
  `logs/server.log` inside its data folder (at most 5 MB, plus one older file),
  whether or not Debug logging is on; with it on (Settings › Advanced), the log
  also records each file change, sync step and agent message by file name and
  id, never what a note says or a credential. Nothing reads or sends it: it
  leaves the machine only if you attach it to a report yourself.
- **Telemetry.** The app sends none, about your notes or anything else.

## Your phone

Signed in, the phone keeps its own copy, so it opens and edits your notes
offline:

- **Every note's text**, with its comments, downloaded from your hosted vault;
  an attachment only once you open it.
- **Your conversations with the agent**, as your Macs sync them.
- **Whatever it has not sent yet.** Edits, new notes, renames, deletions,
  comments and photos wait on the phone until the hosted vault takes them, and
  requests to your Mac wait until one picks them up. A change the vault cannot
  take as it is stays on the phone and says so, until you retry it, keep it as a
  new note or discard it.

It all lives in the app's own storage on the phone. The notes, conversations
and unsent changes sit in a database the app keeps out of the phone's iCloud
backup: a phone restored from a backup downloads your notes again, and
anything it had not sent is gone. A photo waiting to be sent sits in the app's
documents folder, which the backup does include, until it is sent; attachments
you opened sit in the app's cache, which iOS may clear and never backs up. The
phone's sign-in is kept in the iPhone's Keychain, which an encrypted backup
carries, so a phone restored from one comes back signed in.

- **Signing out** on the phone erases all of it — notes, attachments,
  conversations and anything unsent, which it asks about first — and tells the
  cloud to remove the phone from your account. A phone that signs out offline
  forgets its sign-in all the same; revoke it from Settings › Account on a Mac.
- **Revoking the phone** from a Mac, or **deleting the account**, erases the
  same the next time the phone reaches the cloud and is refused. Until then it
  keeps what it holds.

## Retention

- Thread events stay in your Durable Object until the account is deleted. The
  log is append-only — that is what makes multi-device merge trivial — so
  archiving a conversation hides it and deletes nothing; there is no deleting
  one conversation from the cloud.
- A capture is deleted once a Mac has added it to your Inbox note.
- A request from your phone, and a permission question sent to it, is kept for
  a day after a Mac settles it, then deleted the next time a request is sent or
  a Mac checks for one. One still waiting stays until a Mac picks it up, you
  cancel it, or you revoke the phone that sent it, which deletes every request
  of its no Mac has picked up yet; revoking a Mac settles every question it
  sent.
- The hosted vault keeps every version of every file until the account is
  deleted. Deleting a note removes it from the vault, not from its history.
- Device rows (including revoked ones) persist as the dashboard's audit trail
  until account deletion. A device's throttling counters are deleted when it is
  revoked.
- Throttling rows keyed on an address, not an account, cannot be found by
  account deletion. Better Auth deletes every row whose timestamp is over a
  minute old whenever one of its own limits opens a fresh window, so a row
  outlives its minute only until the next such request from anyone; nothing
  sweeps the table on a timer.
- A password-reset link's row (its token and your account's id) is deleted when
  the link is used. One never used stops working after an hour and is swept the
  next time anyone opens a reset link; account deletion does not look for it,
  and once the account is gone it opens nothing.
- Cloudflare's request log keeps each entry for up to seven days.

## Account deletion

You delete the account in the app: Settings › Account › Delete account…, on any
Mac signed in to it. It asks for your password again, and the cloud checks the
password before it deletes anything, so this Mac's sign-in alone cannot end the
account. If you lost your Mac, sign in on any other and delete from there. The
Mac you delete from is signed out; every other device is refused at its next
request.

Deleting the account deletes the account's data, in this order, before the
account row itself goes:

1. **Every device row you own**, with its throttling counters, is deleted from
   D1. This is first on purpose: while a device row lives its credential still
   works, so any later step could be undone by a request that arrives a moment
   after it.
2. **Your hosted vault** — every version of every file, created once a
   signed-in Mac first sends it — with the listing of its file names, sizes and
   content ids kept for your phone's reads and the cached copies of its history
   the cloud serves downloads from. An account whose vault was never sent wipes
   empty tables, so the step is idempotent either way.
3. **Your thread-sync Durable Object** is purged whole: every thread event,
   every capture, every request from your phone and every permission question,
   every open socket closed. It is then tombstoned, so a request that
   authenticated microseconds before step 1 cannot rebuild what was just
   deleted; it is refused instead.
4. **Your email is dropped from the invite you redeemed** (the code stays
   burned).

Then Better Auth deletes your sessions, your password hash and the account row.
All four steps run BEFORE that, so a step that fails aborts the deletion and
leaves the account able to ask again; every step is idempotent, so asking again
resumes. What deletion does NOT touch is your Mac: the local vault, its history
and the local databases are yours. Your phone erases its copy the next time it
is refused (see Your phone). A git server you chose yourself is yours to delete
from. The throttling rows keyed on an address and an unused reset link's row
are not found by it (see Retention), and Cloudflare's request log lapses on its
own.

## The honest edges

- The cloud can read what it holds. Thread events, requests, captures and the
  hosted vault are stored unencrypted to this deployment (Cloudflare encrypts
  its storage at rest, but there is no end-to-end encryption). Don't sync a
  conversation or a vault you wouldn't store in a hosted notes app.
- The cloud writes your hosted vault. Your phone's changes become changes in
  your vault's history that this project's cloud made on the phone's behalf, and
  every Mac takes them in.
- A lost phone holds a full copy of your notes' text and your conversations,
  behind its passcode. Revoke it from Settings › Account on a Mac: it erases its
  copy the next time it goes online, but a phone that never does keeps it.
- A vault in a folder iCloud Drive, Dropbox, Google Drive, OneDrive or Obsidian
  Sync syncs is also held by that service, under its own terms. The app keeps
  such a vault off the hosted vault; it cannot keep the service out of it.
- Deleting a note does not delete its history: every earlier version stays on
  your Mac, on the hosted vault until the account is deleted, and on a git
  server of your own under that server's retention. There is no purge.
- An image you paste or drop into a note on a Mac is kept as the file it was,
  with any location or camera details it carries; only the phone saves a photo
  again without them.
- A revoked device stops at the next request, and its live connection is closed
  as part of the revoke — but revocation cannot reach a response already in
  flight.
- Signing out on a device revokes it the same way, but only if the cloud hears
  the sign-out: a device that signs out offline forgets its credential while its
  row stays active, until you revoke it from Settings › Account on a Mac or from
  the account pages on the website. The desktop's Settings › Account says so
  until it restarts or signs in again.

## Every address the app talks to

Your account's cloud is one origin, `https://inteligir.com`, and every call the
app, the phone or the account pages make to it is one of these routes. Nothing
else under `/v1/` exists.

| Route                              | What it carries                                                                                                                                                                                                      | What authenticates it                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/v1/auth/sign-up`                 | Your email, name, password and invite code, once, to create the account on the website.                                                                                                                              | The invite code; attempts are throttled per caller address.         |
| `/v1/device/login`                 | Your email, password and this device's name, once; it answers the device's credential.                                                                                                                               | Your password; attempts are throttled per caller address.           |
| `/v1/device/sign-up`               | Your name, email, password, invite code and this Mac's name, once, to create the account from the app.                                                                                                               | The invite code; attempts are throttled per caller address.         |
| `/v1/device/sign-out`              | Nothing but the credential; the device it names is removed from your account.                                                                                                                                        | That device's credential.                                           |
| `/v1/device/list`                  | Your devices' names and when each was created, last seen and revoked, for the account pages and Settings › Account.                                                                                                  | Your signed-in browser session, or a signed-in device's credential. |
| `/v1/device/revoke`                | The id of the device to revoke.                                                                                                                                                                                      | Your signed-in browser session, or a signed-in device's credential. |
| `/v1/account`                      | Your account's email and id, answered to a signed-in device.                                                                                                                                                         | The device's credential.                                            |
| `/v1/account/delete`               | Your password, once, to delete the account and everything this page says the cloud holds for it.                                                                                                                     | Your password and the device's credential; throttled per device.    |
| `/v1/sync/push`                    | Your conversations with the agent, as events, including what the agent read and changed, with each one's title, note, agent and archived state.                                                                      | The device's credential.                                            |
| `/v1/sync/pull`                    | The same events, written by your other devices.                                                                                                                                                                      | The device's credential.                                            |
| `/v1/sync/ws`                      | A live connection that says only that something changed, and whether a Mac takes your phone's requests.                                                                                                              | The device's credential.                                            |
| `/v1/capture`                      | The text of a quick capture.                                                                                                                                                                                         | The device's credential.                                            |
| `/v1/sync/captures/claim`          | The captures waiting for a Mac to add them to your Inbox note.                                                                                                                                                       | The device's credential.                                            |
| `/v1/sync/captures/ack`            | The ids of the captures that Mac added.                                                                                                                                                                              | The device's credential and the claim it was handed.                |
| `/v1/sync/dispatch`                | What you ask your Mac's agent from your phone, or your answer to its permission question.                                                                                                                            | The device's credential.                                            |
| `/v1/sync/dispatch/claim`          | The requests waiting for a Mac to pick up, and the answers meant for that Mac.                                                                                                                                       | The device's credential.                                            |
| `/v1/sync/dispatch/ack`            | The ids of the requests that Mac took, and why it turned one down.                                                                                                                                                   | The device's credential and the claim it was handed.                |
| `/v1/sync/dispatch/status`         | Whether your requests are waiting, picked up or answered, and how many Macs are online, taking them or not.                                                                                                          | The device's credential.                                            |
| `/v1/sync/dispatch/cancel`         | The id of a request you took back before a Mac picked it up.                                                                                                                                                         | The device's credential.                                            |
| `/v1/sync/dispatch/approval`       | The command or change an agent wants your permission for, in a conversation your phone started.                                                                                                                      | The device's credential.                                            |
| `/v1/sync/dispatch/approval/close` | The id of a permission question that no longer needs your answer.                                                                                                                                                    | The device's credential.                                            |
| `/v1/sync/dispatch/approvals`      | The permission questions waiting for your answer.                                                                                                                                                                    | The device's credential.                                            |
| `/v1/vault/tree`                   | The names, sizes and content ids of the files in your hosted vault.                                                                                                                                                  | The device's credential, within a per-device budget.                |
| `/v1/vault/file`                   | One note's text from your hosted vault.                                                                                                                                                                              | The device's credential, within a per-device budget.                |
| `/v1/vault/files`                  | Up to 40 notes' text from your hosted vault, in one request.                                                                                                                                                         | The device's credential, within a per-device budget.                |
| `/v1/vault/asset`                  | One attachment from your hosted vault, when your phone opens it.                                                                                                                                                     | The device's credential, within a per-device budget.                |
| `/v1/vault/commit`                 | Your phone's edits, new notes, renames, deletions, comments and photos, saved into your hosted vault as one change named for the phone; a note another device changed first answers its text and that device's name. | The device's credential, within a per-device budget.                |
| `/v1/git/vault.git`                | Your vault and its whole history, sent up from and down to your Macs.                                                                                                                                                | The device's credential, within a per-device budget.                |

Everything else the app reaches is someone else's:

- **GitHub's release feed**, for the desktop's update check described above.
- **Expo's update service**, for the phone's update check described above.
- **The agent's provider** (Anthropic for Claude, OpenAI for ChatGPT). The agent
  runs on your Mac and sends what it reads to that provider, under your own plan
  with them.
- **That provider's sign-in page**, opened in your browser when you sign the
  agent in; the credential it gives back stays in the provider's own store on
  your Mac.
- **The services you connect the agent to**, each at the address you gave it,
  and their own sign-in pages when they ask for one.
- **Your own git server**, if a vault syncs to one instead of your account's
  hosted vault.
