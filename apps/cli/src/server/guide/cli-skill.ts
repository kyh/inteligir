// SKILL.md-shaped so a harness can ingest it verbatim. Must name every CLI leaf
// and every flag it accepts, and no flag it does not: a test walks the citty
// tree against these bytes, so re-flagging a command means editing this text.
// Limits are the contract's own constants, so a changed cap cannot leave a stale range here.

import { IMPORT_FILE_MAX_BYTES } from "@repo/contract/local/imports/imports-schema";
import {
  KNOWLEDGE_ITEMS_DEFAULT_LIMIT,
  KNOWLEDGE_ITEMS_MAX_LIMIT,
  KNOWLEDGE_MATCHES_MAX_LIMIT,
  KNOWLEDGE_RELATED_MAX_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
} from "@repo/contract/local/knowledge/knowledge-schema";
import { ITEM_FILE_MAX_BYTES } from "@repo/notes/items/item-kind";
import {
  THREADS_LIST_DEFAULT_LIMIT,
  THREADS_LIST_MAX_LIMIT,
} from "@repo/contract/local/threads/threads-schema";
import {
  VAULT_HISTORY_DEFAULT_LIMIT,
  VAULT_HISTORY_MAX_LIMIT,
  VAULT_MAX_CONTENT_LENGTH,
} from "@repo/contract/local/vault/vault-schema";
import { DEBUG_TRACES } from "../debug-log";
import {
  DEFAULT_WAIT_POLL_INTERVAL_MS,
  DEFAULT_WAIT_TIMEOUT_SECONDS,
  MAX_WAIT_POLL_INTERVAL_MS,
  MAX_WAIT_TIMEOUT_SECONDS,
} from "./action-wait-bounds";

const MIB = 1024 * 1024;

export const CLI_SKILL_MD = `---
name: inteligir-cli
description: Drive the local inteligir library app — saving links and files, the items, tags, search, agent actions — from the shell.
---

# The inteligir CLI

inteligir is a local-first library of everything a person saves: links,
articles, images, PDFs, files and their own notes, every item one markdown
file in the library's folder, with a knowledge index and an agent. \`vault\` is
this CLI's word for the library folder; talk to the person about their library
and its items, never the vault or its files. The \`inteligir\` CLI drives the
running app over its HTTP API. Every leaf command accepts \`--json\` for
machine-readable output; without it the output is compact human text.

Arguments are strict: a flag the command does not declare, a flag written
before the command's name, and a word past its last argument, are refused
rather than dropped. Quote an argument that holds spaces
(\`inteligir search "two words"\`).

## Finding the server

- \`INTELIGIR_DATA_DIR\` — WHICH instance (it is set inside agent shells). The
  running server publishes \`<dataDir>/server.json\` holding the port it bound
  and the token it answers to, so the CLI never probes and never guesses.
- Unset, the CLI derives the same data dir the app does: the per-checkout dev
  instance, or the installed one under \`NODE_ENV=production\`.
- No readable \`server.json\` means no server: the CLI exits 3 rather than
  dialing anything.
- A server of another release is refused the same way: the CLI and the server
  must be one version, so the message names both and the install that matches.
- \`inteligir status\` prints which server it reached and which vault that
  server is about to write into.
- \`INTELIGIR_THREAD_ID\` — set inside agent shells to the thread you are
  running in. \`inteligir --help\` prints both values under "Environment".

## Running the app

- \`inteligir serve\` — run the local server itself: the vault, the knowledge
  index, the agent and the API. Every other command below drives a server that
  is already running. Flags: \`--port <n>\`, \`--data-dir <path>\`,
  \`--vault <path>\`, \`--open\` (open the workspace in a browser once it is
  listening).
- \`inteligir open\` — open the workspace in a signed-in browser tab. A
  browser cannot carry the server's token, so it signs in through a one-time
  link that expires within minutes; a tab without one gets a page naming this
  command. Under \`--json\` it opens nothing and prints \`{"url": …}\`: hand
  that link to the user rather than opening it yourself. A server with no UI
  (an unbuilt checkout) refuses it as \`NOT_FOUND\`.

## Library — saving and filing

Every item is one markdown file. A saved link's frontmatter holds its \`kind\`,
\`url\`, \`site\` and \`saved\` time, and its body is the page's readable
text once the Mac has read the page, under its cover (the body's first image);
an image, PDF or other file is the original beside a small note that embeds
it. The app writes those keys: never invent one, and never change an item's
\`url\`, \`saved\` or \`id\`. A save lands in \`Unsorted/\` unless it names a
folder, and calls no model: the Mac's own server reads the page. Save with
\`inteligir save\` rather than writing a link item by hand, and run
\`inteligir item find <url>\` first when you are not sure the library lacks
it. Folders are ordinary folders: file an item by moving it with
\`inteligir vault rename\`, which rewrites the links to it, and tag it with
\`inteligir tag add\`. Never edit a page copy (\`assets/pages/\`), and never
move or delete a file an item embeds on its own: \`vault delete\` of the item
takes the files only it embeds. The inteligir-items skill holds the shape.

- \`inteligir save <target>\` — save a web link (\`https://…\`), a file on this
  Mac (at most ${ITEM_FILE_MAX_BYTES / MIB} MB, refused before anything is sent), or, with \`-\`,
  up to 50 web links read from stdin, one per line
  (\`pbpaste | inteligir save -\`). \`--folder <path>\` saves into that folder
  (\`""\` is the library's top), \`--tags <a,b>\` adds tags (comma-separated,
  each without the \`#\`), \`--copy\` keeps a copy of the page (links only),
  and \`--html <file|->\` hands over the page's HTML instead of fetching it
  (one link only). It waits until the page is read (at most a minute);
  \`--no-wait\` answers at once. A link the library already holds is not saved
  twice: the answer is \`Already saved: <path>\`, and its tags are added to
  that item. A page that cannot be read is still saved, and the answer says
  why. \`--json\` answers \`{ fill, outcome, path }\` (\`outcome\` is
  \`created\` or \`exists\`; \`fill.state\` is \`filled\`, \`pending\` or
  \`failed\` with its \`message\`); with \`-\`, \`{ results }\` in stdin's order.
- \`inteligir items\` — the library's items, newest saved first, pinned ones
  leading, one tab-separated line each: path, kind, saved day, site, tags.
  \`--kind <k[,k]>\` keeps those kinds (\`note\`, \`link\`, \`video\`,
  \`audio\`, \`image\`, \`pdf\`, \`file\`); \`--tag <t>\` keeps a tag and the
  tags nested under it; \`--untagged\` keeps items with no tag at all;
  \`--site <host>\` keeps one site; \`--folder <path>\` keeps a folder and its
  subfolders, and \`--flat\` leaves the subfolders out; \`--since <date>\`
  keeps items saved at or after it (\`2026-10-16\`);
  \`--sort saved|modified|title\` orders them; \`--limit <n>\` is the page
  (1–${KNOWLEDGE_ITEMS_MAX_LIMIT}, default ${KNOWLEDGE_ITEMS_DEFAULT_LIMIT}) and \`--offset <n>\` skips to the next one,
  which a cut listing names on its last line.
- \`inteligir item show <path>\` — one item's facts: kind, url, site, author,
  published, saved, fetched, why its page could not be read, folder, cover,
  file, page copy, tags, pinned. A path that is not an item is \`NOT_FOUND\`.
- \`inteligir item find <url>\` — where the library already holds a link,
  matched the way a save dedupes (tracking parameters, \`www.\` and the like
  ignored). Prints \`Not saved yet\` when it holds none.
- \`inteligir item refresh <path>\` — read a saved link's page again. Its text
  is kept unless \`--replace-text\` (refused while it has highlights);
  \`--copy\` also keeps a copy of the page; \`--no-wait\` answers at once.

Filing rules the person wrote for the library live in its own \`AGENTS.md\`
at its top: read it before you file, tag or rename items, and follow it.

## Importing

A Raindrop backup becomes items: each bookmark one link item in a folder named
for its collection (none, or Unsorted, is \`Unsorted/\`; Trash is left out),
with its tags, its note as the item's text, its favourite as \`pinned\`, and its
highlights waiting for its page to fill. The import fetches nothing; every
page fills in afterwards, one at a time.

An import is the person's to start: from an agent's shell \`import raindrop\`
is refused as \`FORBIDDEN\` (its batches land after your turn, where Undo
changes cannot take them back), so run it with \`--dry-run\` to say what it
would do and ask the person to choose Import from Raindrop… in the library.

- \`inteligir import raindrop <file>\` — import a Raindrop backup's CSV (at
  most ${IMPORT_FILE_MAX_BYTES / MIB} MB): links into folders named for its collections, with
  their tags, notes and highlights. A link the library already holds stays as
  it is. It prints what it will do, then waits for the job, printing its
  progress on stderr; \`--dry-run\` prints the plan and imports nothing, and
  \`--no-wait\` answers once the job starts. The job is the answer however it
  ends (\`--json\`: \`{"job":…}\`): one that stopped on an error says \`failed\`
  in its \`state\` and why in its \`message\`. Each page fills in afterwards.
- \`inteligir import status\` — the latest import, running or ended.
- \`inteligir import cancel\` — stop the running import; the items it already
  added stay.

## Vault — files on disk

- \`inteligir vault list [dir]\` — list the tree (folders end with \`/\`);
  \`[dir]\` narrows it to one folder, and a folder that is not there is refused
  as \`NOT_FOUND\` rather than listed as empty.
- \`inteligir vault read <path>\` — print a file's content. Under \`--json\` the
  answer also carries \`hash\`, the base a guarded write names.
- \`inteligir vault write <path> [--content <text>] (--if-absent | --expected-hash <hash> | --overwrite)\`
  — write a file; without \`--content\` the content is read from stdin (UTF-8;
  bytes are preserved exactly, and anything over ${VAULT_MAX_CONTENT_LENGTH / MIB} MiB is refused).
  A terminal or an empty stdin is refused: pass \`--content ''\` to empty a
  file. Parent folders are created. Exactly one guard is required.
  \`--if-absent\` creates only: something already at the path is refused as
  \`ALREADY_EXISTS\`, so pass it whenever you mean a new note.
  \`--expected-hash <hash>\` writes only over the bytes you read — the \`hash\`
  from \`vault read --json\` — and a file that changed since is refused as
  \`CAS_MISMATCH\`: read it again, redo your edit on what it holds now, and
  retry; pass it whenever you edit a note. \`--overwrite\` replaces whatever is
  there, and the last writer wins.
- \`inteligir vault rename <from> <to>\` — rename/move a note or a folder; the
  links into it and out of it are rewritten, and a renamed note's old name is
  recorded as an alias.
- \`inteligir vault history <path> [--skip <n>] [--limit <n>]\` — the note's own
  commits, newest first, following renames; \`--limit\` is the page
  (1–${VAULT_HISTORY_MAX_LIMIT}, default ${VAULT_HISTORY_DEFAULT_LIMIT}). One tab-separated line per
  revision: sha, author date, author, the path AT that revision, subject.
- \`inteligir vault revision <path> <sha>\` — print what the note held at that
  revision. \`<path>\` is the path \`vault history\` reported for that row, not
  necessarily today's name.
- \`inteligir vault restore <path> <sha>\` — put the note back to that
  revision, or bring a deleted file back byte for byte. \`<path>\` here is
  the note's path TODAY, or a path \`vault deleted\` lists. It checkpoints
  the note first (so the bytes being replaced survive as their own revision)
  and writes against the base it read, so a concurrent write is refused
  rather than overwritten; a deleted note is created afresh, and refused if
  something reappeared at its path. A deleted note's files (an item's
  original, its cover) and its annotations come back with it (\`--json\`'s
  \`annotations\` says \`restored\`, \`kept\` when a store already sits at its
  id, or \`none\`); when they cannot, the note stays restored and the command
  fails in the refusal's own class, its message naming the note. Prefer this over piping
  \`revision\` into \`write\`: it checkpoints and guards in one step.
- \`inteligir vault delete <path>\` — delete a file or folder. There is no
  trash: a deleted doc stays in the vault's git history.
- \`inteligir vault deleted\` — notes and files no longer on disk, newest
  deletion first, one tab-separated line each: the sha that still holds the
  bytes, when, path, and for a file deleted with the note that embedded it,
  \`held by <note>\`. Feed a row to \`vault restore <path> <sha>\` to bring it
  back; a note's held files come back with it.
- \`inteligir vault mkdir <path>\` — create a folder.
- \`inteligir vault new-id <path>\` — give a note that shares another's
  frontmatter \`id\` an id of its own. A copied file (\`cp\`, Finder's
  duplicate) keeps its original's \`id\`, so the two share one annotation store and
  one \`[[Title|uuid]]\` identity until this runs on the copy. To find a note's
  copies, read its \`id\` and run \`inteligir matches <id>\`: each row on an
  \`id:\` line is a note carrying it, and a row elsewhere is a link to it.
  Never delete the copy's \`id:\` line instead: its annotation markers would lose
  the bodies the store keeps under that id. The note takes a new id on the same
  line and a copy of the annotation store kept under the old one, so both notes
  keep every annotation and diverge from here; the note keeping the old id keeps its
  \`[[Title|uuid]]\` links and its actions.
  \`--json\` answers the \`path\`, the new \`id\` and \`annotations\` (\`copied\`, or
  \`none\` when there was no store). A note that changed since it was read is
  refused as \`CAS_MISMATCH\` and left as it was: run it again.
- \`inteligir vault open <dir>\` — select the vault the next \`inteligir serve\`
  boots on (the app's own vault switch writes the same selector). A running
  server is untouched and named; restart it, or reopen the app, to switch.
  Every vault keeps its own data dir beneath the root, so one opened for the
  first time starts with no index and no credential. \`--json\` also carries the folder's
  \`externalSync\` (another service that syncs it, so the hosted vault stays
  off) and \`remote\` (its own git origin, which it keeps syncing with).
- \`inteligir vault attachments [root|beside-note|folder:<path>]\` — where a
  pasted image lands; with no argument, print the current choice.
- \`inteligir vault remote [account|<url>]\` — where the vault syncs: \`account\`
  (the signed-in account's hosted vault; signed out, nowhere until a sign-in)
  or the git URL of a server of the user's own (\`https://\`, \`ssh://\`,
  \`git://\`, \`file://\` or \`user@host:path\`), dialled with this machine's git
  credentials. It edits the vault repo's own \`origin\`, the one record a sync
  reads, and a sync starts at once. With no argument, print the current remote,
  redacted, and where it comes from. \`--json\` answers the vault status
  (\`remote\`, \`remoteSource\`: \`account\`, \`explicit\` or \`pinned\`). A vault
  whose remote \`INTELIGIR_VAULT_REMOTE\` pins refuses a change as \`CONFLICT\`.
  Choosing where a person's notes sync is theirs to decide: ask before changing it.
- \`inteligir vault status\` — git sync state (remote, dirty), then one line
  per note two devices changed at once since the server started: which
  version stayed and which note holds the other. A sync never stops on one;
  \`--json\` carries them as \`conflicts\`, beside this device's name as
  \`device\`.
- \`inteligir vault sync\` — run a sync against the configured remote now.

Paths are vault-relative POSIX paths (\`notes/idea.md\`). Prefer wiki links
(\`[[Note name]]\`) inside note bodies.

## Knowledge — the derived index

- \`inteligir search <query>\` — full-text search; \`tag:<name>\` terms narrow
  by tag and compose with text (\`inteligir search "tag:project deadline"\`).
  \`--limit <n>\` caps results (1–${KNOWLEDGE_SEARCH_MAX_LIMIT}).
- \`inteligir matches <text>\` — every literal occurrence of a text, one row
  per match as \`path:line:column\` with the line around it. Unlike \`search\`
  it scans the bytes: no stemming, no ranking. \`--case-sensitive\` and
  \`--whole-word\` narrow; \`--limit <n>\` caps rows (1–${KNOWLEDGE_MATCHES_MAX_LIMIT}).
- \`inteligir backlinks <path>\` — the notes linking INTO a note.
- \`inteligir related <path>\` — notes connected to a note WITHOUT linking to
  it: shared link targets, shared tags, similar text. Each row is followed by
  the reasons it is there. \`--limit <n>\` caps results (1–${KNOWLEDGE_RELATED_MAX_LIMIT}).
- \`inteligir tags\` — every tag with its usage count, most used first. The
  items holding one are \`inteligir items --tag <tag>\`.
- \`inteligir tag add <tag> <path>\` — add a tag (spelled without the \`#\`) to
  an item's properties; every other byte of the file is kept.
- \`inteligir tag remove <tag> <path>\` — take a tag off an item's properties.
  A note can also hold the tag as \`#tag\` in its text, which this leaves, and
  the answer says so. \`--json\` answers the one item's result for either:
  \`{ inline, outcome, path }\`. An item that is gone is \`NOT_FOUND\`.
- \`inteligir tag rename <from> <to>\` — rename a tag (spelled without the
  \`#\`) in every note, nested tags under it included; a note that changed
  mid-rename is reported as skipped, never overwritten.

## Actions — the agent

- \`inteligir action list\` — actions with status, most recently active
  first, a page at a time: \`--limit <n>\` is the page (1–${THREADS_LIST_MAX_LIMIT}, default
  ${THREADS_LIST_DEFAULT_LIMIT}) and a cut listing ends with the \`--cursor <c>\` that
  continues it. The cursor continues the same query, so its flags must be
  repeated, and the hint repeats them. Archived actions are left out unless
  \`--archived\` is given, and then listed after the rest; \`--doc <path>\` keeps
  the actions attached to that note and \`--running\` those whose turn is
  running.
- \`inteligir action new [--doc <path>] <prompt>\` — start an action
  (optionally attached to a note) and send the first turn. If the action is
  created but its first turn fails, the failure names the new id so you can
  retry or archive it. \`--preset tidy-library\` runs Tidy my library: the
  agent tags and files every Unsorted or untagged item by the library's
  filing rules; the prompt is then optional, and is sent with it.
- \`inteligir action send <id> <prompt>\` — send a follow-up; starts a turn
  when the action is idle, queues behind a running one otherwise. A message
  still waiting in the queue always starts before a later send.
- \`inteligir action show <id>\` — action detail plus the compact timeline
  (turns, commands, file changes, messages), and any approval it is waiting on
  with what that approval would allow.
- \`inteligir action wait <id>\` — block until the action settles. Exit code
  0 = idle, 1 = settled in error, 2 = timeout. \`--timeout <seconds>\` is a
  real wall-clock bound (default ${DEFAULT_WAIT_TIMEOUT_SECONDS}, at most ${MAX_WAIT_TIMEOUT_SECONDS}) and
  \`--poll-interval <ms>\` sets the poll cadence (default ${DEFAULT_WAIT_POLL_INTERVAL_MS}, at most ${MAX_WAIT_POLL_INTERVAL_MS}).
  An action blocked on an approval does not settle until someone answers it:
  \`wait\` says so on stderr, naming each interaction and the
  \`inteligir interactions answer\` command, and keeps waiting; a timeout names
  them too. \`--until-input\` stops instead, with exit 4
  (\`AWAITING_INTERACTION\`): answer, then \`wait\` again.
- \`inteligir action stop <id>\` — stop the action's running turn. The agent is
  asked to stop and the action reads \`stopping\` until it does; one that does
  not answer within a few seconds has its session closed. \`wait\` after it to
  see the turn settle. A message queued behind the turn starts next. A turn
  running on another signed-in device cannot be stopped from here
  (\`CONFLICT\`).
- \`inteligir action archive <id>\` — archive an action, stopping a turn it is
  running.
- \`inteligir action changes <id>\` — the vault paths each of the action's
  turns changed, oldest first, each turn \`applied\` or \`undone\`. A turn counts
  the files it reported writing (its file changes and its own \`inteligir\`
  writes), never an edit made beside it; a turn that changed nothing is not
  listed. Under \`--json\` each turn also carries \`items\`, what the person is
  told it changed: each move once, at the path it made, and no cover or
  original beside the item that embeds it.
- \`inteligir action undo <id> [--turn <turnId>]\` — take back what one turn
  changed (by default the newest turn not yet undone), keeping every edit made
  since: each note it changed goes back to how it was before that turn, with
  later edits merged in. A note edited since where the turn changed it, deleted
  or made again since, being changed by a running turn, or not text is kept
  as it is and named with its reason; its history still holds the version from
  before the turn. A turn still running, or already undone, is refused
  (\`CONFLICT\`). When the user asks you, inside an action, to undo what you
  did, run it on your own action (\`$INTELIGIR_THREAD_ID\`) with the \`--turn\`
  of the earlier turn from \`inteligir action changes\`: the turn you are in has
  not finished, so it cannot be undone yet.

The spawn-and-wait loop an agent should use:

\`\`\`sh
id=$(inteligir action new "Summarize notes/inbox.md" --json | jq -r .thread.id)
inteligir action wait "$id" && inteligir action show "$id"
\`\`\`

## Annotations — highlights and notes on an item's text

An annotation is a highlighted passage and an optional note on it, with
replies under it. Annotations live in \`.inteligir/annotations/<item-id>.json\`,
keyed by the item's frontmatter \`id\` (minted on the first annotation); the
\`%%i:id:start%%…%%i:id:end%%\` body markers wrap the passages they are
about (the inteligir-annotations skill states the grammar — follow it when
editing files directly). There is no resolve: remove an annotation once it
has done its job. Use one to point the person at a passage (a claim to check,
an answer to their question), never to fix wording. An annotation with a quote
and no markers is waiting for its page's text; leave it, the app places it.

- \`inteligir annotation list <path>\` — an item's annotations, one line each:
  id, state, the quoted passage and the note, with replies beneath.
  \`anchored\` means its markers are in the text; \`waiting\` means the item's
  page is still being read and the highlight is placed once it is; \`missing\`
  means its passage is no longer in the text.
- \`inteligir annotation add <path> <quote>\` — highlight a passage: the
  markers are written around the first place \`<quote>\` appears in the text
  (\`--occurrence <n>\` picks a later one), and \`--note <text>\` gives it a
  note. A quote the text does not hold is refused.
- \`inteligir annotation edit <path> <id> <text>\` — rewrite an annotation's
  note or a reply (\`""\` takes a note away and keeps the highlight).
- \`inteligir annotation reply <path> <parent-id> <text>\` — reply under an
  annotation.
- Each of those signs its entry \`agent\` inside an agent shell
  (\`INTELIGIR_THREAD_ID\` set) and \`user\` otherwise.
- \`inteligir annotation remove <path> <id>\` — remove a highlight: its
  markers in the text, and its note and replies.

## Agents — the harnesses actions run on

- \`inteligir agents list\` — each harness (claude, codex): whether its
  bundled runtime is there, what its vendor says of the sign-in, and which is
  the default.
- \`inteligir agents default <id>\` — the harness a NEW action starts on; a
  running action keeps the one it started on.

## Interactions — approvals the agent is waiting on

- \`inteligir interactions list [--thread <id>]\` — pending approval requests,
  each with what it would allow (\`$ <command> (in <cwd>)\`, or
  \`write <scope>\`, and the agent's reason) and the answers it takes;
  \`--thread\` narrows to one thread. Read it before answering.
- \`inteligir interactions answer <id> <decision> [--thread <id>]\` — answer
  one; a decision is \`allow_once\`, \`allow_for_session\`, or \`deny\` (a
  request may offer only some of them, and the CLI says which). \`--thread\`
  names the owning thread; omitted, it is looked up from the listing.

## Cloud — this install's account

Signing in puts this install's library on the account, where its other
devices reach it. It is off until this install signs in. Threads stay on the
machine that ran them: the account carries no thread.

- \`inteligir cloud status\` — whether this install is signed in, and whether its
  account socket is up, which is what tells it another device changed the
  library.
- \`inteligir cloud login --email <address> [--password <password>] [--name <device>]\`
  — sign this machine in with the account's own email and password; it gets
  its own device credential, revocable from Settings › Account on any signed-in
  Mac, or the account's Devices page.
  \`--password -\` reads the password from stdin; omitted on a terminal, it is
  prompted for without echo; under \`--json\` it is required. \`--name\` sets how
  this machine appears in the account's device list (default: the hostname).
  Signing in is a person's act: never guess or retry a password — ask the user
  for theirs, and prefer handing them the command to running it yourself.

The library itself syncs through \`inteligir vault sync\`; use it before reporting a
long task done, so the work has actually reached the account.

There is no \`logout\` here: signing out stops the library syncing through the
account, and that is the person's choice, so it is Sign out in the app's
Settings › Account. Nor is there a sign-up: creating an account takes the
user's own invite code and password, so it is theirs to do in the app. Deleting
the account is the same: it takes the user's password and cannot be undone, so
it lives in Settings › Account, where it says what goes and what stays.

## System

- \`inteligir status\` — server version, data dir, agent runtime state, and
  the current thread context.
- \`inteligir guide\` — print this manual.
- \`inteligir native-host\` — the browser extension's door; Chrome starts it,
  never run it yourself (\`--install\` writes a checkout's door for the dev
  extension).

## Diagnostics

When an edit on disk never shows up, a saved link is never read, or an agent
turn goes quiet, start the server with \`INTELIGIR_DEBUG\` naming what to trace,
comma-separated (\`INTELIGIR_DEBUG=watcher,knowledge inteligir serve\`). Each
decision is written to the server's stderr as a \`[debug:<name>]\` line:

${Object.entries(DEBUG_TRACES)
  .map(([name, traced]) => `- \`${name}\` — ${traced}.`)
  .join("\n")}

A line names paths and ids, never a note's content or a credential, so it can
be pasted into a report. A name not listed here is refused at boot. In the
desktop app, Settings › Advanced › Debug logging traces every name above from
the next restart, and whatever the app's server prints, traced or not, is kept
in \`logs/server.log\` under the data dir (\`inteligir status\` names it). The
app started from a terminal with the variable set still passes it to its
server.

## Exit codes and failure output

0 success · 1 error (including a thread that settled in error) ·
2 wait timeout · 3 no server reachable · 4 an approval is waiting
(\`action wait --until-input\`) · 130 interrupted (^C).

Every command checks the server's HTTP status before printing: a refusal is
never printed as an answer. Failures go to **stderr** and stdout stays empty,
so a \`--json\` caller can parse stdout unconditionally. Under \`--json\` the
failure itself is JSON on stderr: \`{"error":"<class>","message":"<text>"}\`,
where \`<class>\` is the server's own error class where there is one
(\`NOT_FOUND\`, \`BAD_REQUEST\`, \`CAS_MISMATCH\`, …; each exits 1) or one of
the CLI's own, each with the exit code it carries:

- \`INVALID_USAGE\` (1) — the command line itself: an unknown flag, a missing
  or extra argument, a value out of range. Nothing was sent.
- \`NOT_FOUND\` (1) — \`interactions answer\` named no open interaction, or
  \`vault list\` no folder.
- \`SEND_FAILED\` (1) — \`action new\` created the action but its first turn
  never reached the server (a refusal the server did send keeps its own
  class); the message names the new id either way.
- \`THREAD_ERROR\` (1) — the action \`action wait\` was watching settled in
  error.
- \`UNEXPECTED_RESPONSE\` (1) — the server answered a shape the CLI did not ask
  for.
- \`UNEXPECTED\` (1) — anything else; the message says what.
- \`WAIT_TIMEOUT\` (2) — \`action wait\` ran out of time.
- \`SERVER_UNREACHABLE\` (3) — no \`server.json\`, or nothing answered at the
  port it names.
- \`SERVER_VERSION_MISMATCH\` (3) — the server that \`server.json\` names is
  another release than this CLI. Nothing was sent.
- \`AWAITING_INTERACTION\` (4) — \`action wait --until-input\` met an approval.
- \`INTERRUPTED\` (130) — the password prompt was left with ^C or ^D. A ^C
  anywhere else also exits 130, with no failure line at all.

Classes are \`UPPER_SNAKE\` on both sides — one vocabulary, whichever side
raised it.
`;
