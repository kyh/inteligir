// SKILL.md-shaped so a harness can ingest it verbatim. Must name every CLI leaf
// and every flag it accepts, and no flag it does not: a test walks the citty
// tree against these bytes, so re-flagging a command means editing this text.

export const CLI_SKILL_MD = `---
name: inteligir-cli
description: Drive the local inteligir notes app — vault files, knowledge search, agent actions — from the shell.
---

# The inteligir CLI

inteligir is a local-first notes app: a vault of markdown files with a
knowledge index and an agent. The \`inteligir\` CLI drives the running app over
its HTTP API. Every leaf command accepts \`--json\` for machine-readable
output; without it the output is compact human text.

## Finding the server

- \`INTELIGIR_DATA_DIR\` — WHICH instance (it is set inside agent shells). The
  running server publishes \`<dataDir>/server.json\` holding the port it bound
  and the token it answers to, so the CLI never probes and never guesses.
- Unset, the CLI derives the same data dir the app does: the per-checkout dev
  instance, or the installed one under \`NODE_ENV=production\`.
- No readable \`server.json\` means no server: the CLI exits 3 rather than
  dialing anything.
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

## Vault — files on disk

- \`inteligir vault list [dir]\` — list the tree (folders end with \`/\`).
- \`inteligir vault read <path>\` — print a file's content.
- \`inteligir vault write <path> [--content <text>]\` — write a file; without
  \`--content\` the content is read from stdin (UTF-8; bytes are preserved
  exactly, and anything over 10 MiB is refused). Parent folders are created.
- \`inteligir vault rename <from> <to>\` — rename/move a note; wiki links into
  it are rewritten and the old name is recorded as an alias.
- \`inteligir vault history <path> [--skip <n>] [--limit <n>]\` — the note's own
  commits, newest first, following renames. One tab-separated line per
  revision: sha, author date, author, the path AT that revision, subject.
- \`inteligir vault revision <path> <sha>\` — print what the note held at that
  revision. \`<path>\` is the path \`vault history\` reported for that row, not
  necessarily today's name.
- \`inteligir vault restore <path> <sha>\` — put the note back to that
  revision. \`<path>\` here is the note's path TODAY, or a path \`vault
  deleted\` lists. It checkpoints the vault first (so the bytes being replaced
  survive as their own revision) and writes against the base it read, so a
  concurrent write is refused rather than overwritten; a deleted note is
  created afresh, and refused if something reappeared at its path. Prefer this
  over piping \`revision\` into \`write\`, which carries no such guard.
- \`inteligir vault delete <path>\` — delete a file or folder. There is no
  trash: a deleted doc stays in the vault's git history.
- \`inteligir vault deleted\` — docs no longer on disk, newest deletion first,
  one tab-separated line each: the sha that still holds the bytes, when, path.
  Feed a row to \`vault restore <path> <sha>\` to bring it back.
- \`inteligir vault mkdir <path>\` — create a folder.
- \`inteligir vault attachments [root|beside-note|folder:<path>]\` — where a
  pasted image lands; with no argument, print the current choice.
- \`inteligir vault status\` — git sync state (remote, dirty, conflicts).
- \`inteligir vault sync\` — run a sync against the configured remote now.

Paths are vault-relative POSIX paths (\`notes/idea.md\`). Prefer wiki links
(\`[[Note name]]\`) inside note bodies.

## Knowledge — the derived index

- \`inteligir search <query>\` — full-text search; \`tag:<name>\` terms narrow
  by tag and compose with text (\`inteligir search "tag:project deadline"\`).
  \`--limit <n>\` caps results (1–100).
- \`inteligir matches <text>\` — every literal occurrence of a text, one row
  per match as \`path:line:column\` with the line around it. Unlike \`search\`
  it scans the bytes: no stemming, no ranking. \`--case-sensitive\` and
  \`--whole-word\` narrow; \`--limit <n>\` caps rows (1–500).
- \`inteligir backlinks <path>\` — the notes linking INTO a note.
- \`inteligir related <path>\` — notes connected to a note WITHOUT linking to
  it: shared link targets, shared tags, similar text. Each row is followed by
  the reasons it is there. \`--limit <n>\` caps results (1–50).
- \`inteligir tags\` — every tag with its usage count, most used first.
- \`inteligir tag rename <from> <to>\` — rename a tag (spelled without the
  \`#\`) in every note, nested tags under it included; a note that changed
  mid-rename is reported as skipped, never overwritten.

## Actions — the agent

- \`inteligir action list\` — all actions with status.
- \`inteligir action new [--doc <path>] <prompt>\` — start an action
  (optionally attached to a note) and send the first turn. If the action is
  created but its first turn fails, the failure names the new id so you can
  retry or archive it.
- \`inteligir action send <id> <prompt>\` — send a follow-up; starts a turn
  when the action is idle, queues behind a running one otherwise.
- \`inteligir action show <id>\` — action detail plus the compact timeline
  (turns, commands, file changes, messages).
- \`inteligir action wait <id>\` — block until the action settles. Exit code
  0 = idle, 1 = settled in error, 2 = timeout. \`--timeout <seconds>\` is a
  real wall-clock bound (default 600) and \`--poll-interval <ms>\` sets the
  poll cadence (default 300).
- \`inteligir action archive <id>\` — archive an action.

The spawn-and-wait loop an agent should use:

\`\`\`sh
id=$(inteligir action new "Summarize notes/inbox.md" --json | jq -r .thread.id)
inteligir action wait "$id" && inteligir action show "$id"
\`\`\`

## Comments — the review channel

Anchored comments live in a \`<note>.comments.json\` sidecar beside the note;
the \`%%i:id:start%%…%%i:id:end%%\` body markers wrap the ranges they are
about (the inteligir-comments skill states the grammar — follow it when
editing files directly).

- \`inteligir comment list <path>\` — a note's comment threads, replies and
  resolution state.
- \`inteligir comment add <path> <text>\` — start a thread in the sidecar. It
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
  and whether it is enabled and authenticated.
- \`inteligir connectors add <name> --url <https://…> [--header NAME=VALUE]\` —
  add a remote server (the header carries its API key). For a local stdio
  server, name the program after \`--\` instead:
  \`inteligir connectors add <name> -- <command> [args…]\`. Exactly one of the
  two forms.
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

- \`inteligir interactions list [--thread <id>]\` — pending approval requests;
  \`--thread\` narrows to one thread.
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
2 wait timeout · 3 no server reachable.

Every command checks the server's HTTP status before printing: a refusal is
never printed as an answer. Failures go to **stderr** and stdout stays empty,
so a \`--json\` caller can parse stdout unconditionally. Under \`--json\` the
failure itself is JSON on stderr: \`{"error":"<class>","message":"<text>"}\`,
where \`<class>\` is the server's own error class where there is one
(\`NOT_FOUND\`, \`BAD_REQUEST\`, …) or a CLI one otherwise
(\`INVALID_USAGE\`, \`WAIT_TIMEOUT\`, \`SERVER_UNREACHABLE\`). Classes are
\`UPPER_SNAKE\` on both sides — one vocabulary, whichever side raised it.
`;
