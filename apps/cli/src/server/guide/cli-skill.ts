// SKILL.md-shaped so a harness can ingest it verbatim. Must name every CLI leaf
// and every flag it accepts, and no flag it does not: a test walks the citty
// tree against these bytes, so re-flagging a command means editing this text.
// Limits are the contract's own constants, so a changed cap cannot leave a stale range here.

import {
  KNOWLEDGE_MATCHES_MAX_LIMIT,
  KNOWLEDGE_PROBLEMS_MAX_LIMIT,
  KNOWLEDGE_RELATED_MAX_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT,
  KNOWLEDGE_TAG_NOTES_MAX_LIMIT,
  KNOWLEDGE_UNLINKED_MAX_LIMIT,
} from "@repo/api/local/knowledge/knowledge-schema";
import {
  THREADS_LIST_DEFAULT_LIMIT,
  THREADS_LIST_MAX_LIMIT,
} from "@repo/api/local/threads/threads-schema";
import {
  VAULT_HISTORY_DEFAULT_LIMIT,
  VAULT_HISTORY_MAX_LIMIT,
  VAULT_MAX_CONTENT_LENGTH,
} from "@repo/api/local/vault/vault-schema";

const MIB = 1024 * 1024;

export const CLI_SKILL_MD = `---
name: inteligir-cli
description: Drive the local inteligir notes app — vault files, knowledge search, agent actions — from the shell.
---

# The inteligir CLI

inteligir is a local-first notes app: a vault of markdown files with a
knowledge index and an agent. The \`inteligir\` CLI drives the running app over
its HTTP API. Every leaf command accepts \`--json\` for machine-readable
output; without it the output is compact human text.

Arguments are strict: a flag the command does not declare, and a word past its
last argument, are refused rather than dropped. Quote an argument that holds
spaces (\`inteligir search "two words"\`).

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
  that link to the user rather than opening it yourself.

## Vault — files on disk

- \`inteligir vault list [dir]\` — list the tree (folders end with \`/\`);
  \`[dir]\` narrows it to one folder, and a folder that is not there is refused
  as \`NOT_FOUND\` rather than listed as empty.
- \`inteligir vault read <path>\` — print a file's content. Under \`--json\` the
  answer also carries \`hash\`, the base a guarded write names.
- \`inteligir vault write <path> [--content <text>] [--if-absent | --expected-hash <hash>]\`
  — write a file; without \`--content\` the content is read from stdin (UTF-8;
  bytes are preserved exactly, and anything over ${VAULT_MAX_CONTENT_LENGTH / MIB} MiB is refused).
  A terminal or an empty stdin is refused: pass \`--content ''\` to empty a
  file. Parent folders are created. \`--if-absent\` creates only: something
  already at the path is refused as \`ALREADY_EXISTS\`, so pass it whenever you
  mean a new note. \`--expected-hash <hash>\` writes only over the bytes you
  read — the \`hash\` from \`vault read --json\` — and a file that changed since
  is refused as \`CAS_MISMATCH\`: read it again, redo your edit on what it holds
  now, and retry. Without either, the last writer wins. The two cannot be
  combined.
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
  revision. \`<path>\` here is the note's path TODAY, or a path \`vault
  deleted\` lists. It checkpoints the vault first (so the bytes being replaced
  survive as their own revision) and writes against the base it read, so a
  concurrent write is refused rather than overwritten; a deleted note is
  created afresh, and refused if something reappeared at its path. A deleted
  note's comments come back with it (\`--json\`'s \`comments\` says
  \`restored\`, \`kept\` when a store already sits at its id, or \`none\`); when
  they cannot, the note stays restored and the command fails in the refusal's
  own class, its message naming the note. Prefer this over piping
  \`revision\` into \`write\`: it checkpoints and guards in one step.
- \`inteligir vault delete <path>\` — delete a file or folder. There is no
  trash: a deleted doc stays in the vault's git history.
- \`inteligir vault deleted\` — docs no longer on disk, newest deletion first,
  one tab-separated line each: the sha that still holds the bytes, when, path.
  Feed a row to \`vault restore <path> <sha>\` to bring it back.
- \`inteligir vault mkdir <path>\` — create a folder.
- \`inteligir vault open <dir>\` — select the vault the next \`inteligir serve\`
  boots on (the app's own vault switch writes the same selector). A running
  server is untouched and named; restart it, or reopen the app, to switch. A
  vault other than the default keeps its own data dir beneath the root, so it
  starts with no index, no credential and no connectors.
- \`inteligir vault attachments [root|beside-note|folder:<path>]\` — where a
  pasted image lands; with no argument, print the current choice.
- \`inteligir vault status\` — git sync state (remote, dirty, conflicts).
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
- \`inteligir unlinked <path>\` — notes that name a note in prose (its stem or
  an alias, as a whole word) without linking it, one row per note as
  \`path:line:column\` with the sentence; code, links, urls and frontmatter do
  not count. Wrap that text as \`[[Title]]\` to make it a link. \`--limit <n>\`
  caps rows (1–${KNOWLEDGE_UNLINKED_MAX_LIMIT}).
- \`inteligir problems\` — what the graph cannot resolve: wiki links to notes
  that do not exist (with the source and line), embeds of missing files, notes
  nothing links to, stems spelled at more than one path, and frontmatter \`id\`s
  carried by more than one note. A copied file (\`cp\`, Finder's duplicate)
  keeps its original's \`id\`, so the two share one comment store and one
  \`[[Title|uuid]]\` identity; drop the \`id:\` line from the copy. Daily notes and
  templates are orphans by design and are left out unless
  \`--include-conventions\` is given. \`--limit <n>\` caps each family
  (1–${KNOWLEDGE_PROBLEMS_MAX_LIMIT}).
- \`inteligir related <path>\` — notes connected to a note WITHOUT linking to
  it: shared link targets, shared tags, similar text. Each row is followed by
  the reasons it is there. \`--limit <n>\` caps results (1–${KNOWLEDGE_RELATED_MAX_LIMIT}).
- \`inteligir tags\` — every tag with its usage count, most used first.
- \`inteligir tag notes <tag>\` — every note holding the tag or one nested under
  it, by path; \`--limit <n>\` is the page (1–${KNOWLEDGE_TAG_NOTES_MAX_LIMIT}, default
  ${KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT}) and \`--offset <n>\` skips to the next one.
- \`inteligir tag rename <from> <to>\` — rename a tag (spelled without the
  \`#\`) in every note, nested tags under it included; a note that changed
  mid-rename is reported as skipped, never overwritten.

## Actions — the agent

- \`inteligir action list\` — actions with status, most recently active
  first, a page at a time: \`--limit <n>\` is the page (1–${THREADS_LIST_MAX_LIMIT}, default
  ${THREADS_LIST_DEFAULT_LIMIT}) and a cut listing ends with the \`--cursor <c>\` that
  continues it. Archived actions are left out unless \`--archived\` is given,
  and then listed after the rest; \`--doc <path>\` keeps the actions attached
  to that note and \`--running\` those whose turn is running.
- \`inteligir action new [--doc <path>] <prompt>\` — start an action
  (optionally attached to a note) and send the first turn. If the action is
  created but its first turn fails, the failure names the new id so you can
  retry or archive it.
- \`inteligir action send <id> <prompt>\` — send a follow-up; starts a turn
  when the action is idle, queues behind a running one otherwise. A message
  still waiting in the queue always starts before a later send.
- \`inteligir action show <id>\` — action detail plus the compact timeline
  (turns, commands, file changes, messages), and any approval it is waiting on
  with what that approval would allow.
- \`inteligir action wait <id>\` — block until the action settles. Exit code
  0 = idle, 1 = settled in error, 2 = timeout. \`--timeout <seconds>\` is a
  real wall-clock bound (default 600, at most 86400) and
  \`--poll-interval <ms>\` sets the poll cadence (default 300, at most 60000).
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

The spawn-and-wait loop an agent should use:

\`\`\`sh
id=$(inteligir action new "Summarize notes/inbox.md" --json | jq -r .thread.id)
inteligir action wait "$id" && inteligir action show "$id"
\`\`\`

## Comments — the review channel

Anchored comments live in \`.inteligir/comments/<note-id>.json\`, keyed by
the note's frontmatter \`id\` (minted on the first comment); the
\`%%i:id:start%%…%%i:id:end%%\` body markers wrap the ranges they are
about (the inteligir-comments skill states the grammar — follow it when
editing files directly).

- \`inteligir comment list <path>\` — a note's comment threads, replies and
  resolution state.
- \`inteligir comment add <path> <text>\` — start a thread in the store. It
  is UNANCHORED until markers wrap a range in the note body.
- \`inteligir comment reply <path> <parent-id> <text>\` — reply in a thread.
- \`inteligir comment resolve <path> <id>\` — resolve a thread
  (\`--reopen\` reverses it).
- Each of those three signs its entry: \`agent\` inside an agent shell
  (\`INTELIGIR_THREAD_ID\` set), \`user\` otherwise;
  \`--source <user|agent|external>\` overrides.
- \`inteligir comment remove <path> <id>\` — delete a thread's entries; the
  answer names the marker ids you still owe the note body.

## Connectors — the MCP servers every session gets

The registry is this app's own; enabled rows reach every agent session's
launch, Claude Code and Codex alike.

- \`inteligir connectors list\` — the configured servers, each with its target
  and whether it is enabled and authenticated; an OAuth server shows
  \`needs-auth\`, \`connected\` or \`needs-reauth\`.
- \`inteligir connectors add <name> --url <https://…> [--header NAME=VALUE]\` —
  add a remote server (the header carries its API key). \`--header NAME=-\`
  reads the value from stdin instead, which keeps the key out of the process
  list and the shell's history:
  \`printf '%s' "$KEY" | inteligir connectors add <name> --url <…> --header x-api-key=-\`.
  A server that signs in with OAuth takes \`--oauth\` in place of a header:
  \`inteligir connectors add <name> --url <https://…> --oauth\`; its endpoints
  and client are found from the URL when the user connects it in Settings →
  Connectors, and sessions get it once it reads \`connected\`.
  For a local stdio server, name the program after \`--\` instead:
  \`inteligir connectors add <name> -- <command> [args…]\`. Exactly one of the
  two forms; \`--header\` and \`--oauth\` are for the remote one.
- \`inteligir connectors remove <name>\` — remove one; sessions stop getting it
  from their next launch.

## Connected folders — reference context you are pointed at

Directories the user offers as read-only reference (also in
\`$INTELIGIR_CONNECTED_DIRS\`). Read them freely with your own shell; treat
them as read-only — do not modify them.

- \`inteligir folders list\` — the connected folders.
- \`inteligir folders add <absolute-path>\` — connect one.
- \`inteligir folders remove <path>\` — disconnect one.

## Agents — the harnesses actions run on

- \`inteligir agents list\` — each harness (claude, codex): CLI on PATH, signed
  in, and which is the default.
- \`inteligir agents default <id>\` — the harness a NEW action starts on; a
  running action keeps the one it started on.

## Interactions — approvals the agent is waiting on

- \`inteligir interactions list [--thread <id>]\` — pending approval requests,
  each with what it would allow (\`$ <command> (in <cwd>)\`, or
  \`write <scope>\`, and the agent's reason) and the answers it takes;
  \`--thread\` narrows to one thread. Read it before answering.
- \`inteligir interactions answer <id> <resolution> [--thread <id>]\` — answer
  one; resolutions are \`allow_once\`, \`allow_for_session\`, or \`deny\` (a
  request may offer only some of them, and the CLI says which). \`--thread\`
  names the owning thread; omitted, it is looked up from the listing.

## Cloud — this install's account

Cloud sync carries THREADS and their history between the devices on one
account. It is off until this install signs in, and it never carries vault
files — those are git's job.

- \`inteligir cloud status\` — whether this install is signed in, how many
  events are queued for the account, and how far behind it is.
- \`inteligir cloud login --email <address> [--password <password>] [--name <device>]\`
  — sign this machine in with the account's own email and password; it gets
  its own device credential, revocable from the account's Devices page.
  \`--password -\` reads the password from stdin; omitted on a terminal, it is
  prompted for without echo; under \`--json\` it is required. \`--name\` sets how
  this machine appears in the account's device list (default: the hostname).
  Signing in is a person's act: never guess or retry a password — ask the user
  for theirs, and prefer handing them the command to running it yourself.
- \`inteligir cloud sync\` — run a pass now (drain the outbox, pull, apply) and
  print the state it left behind. Use it before reporting a long task done, so
  the work has actually reached the account.

There is no \`logout\` here: it discards writes that have not reached the
account yet, so it lives in the app's Settings → Devices, in front of the state
it would throw away.

## System

- \`inteligir status\` — server version, data dir, agent runtime state, and
  the current thread context.
- \`inteligir guide\` — print this manual.

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
