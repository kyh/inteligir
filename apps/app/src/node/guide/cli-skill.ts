// The built-in agent guide, served at GET /api/v1/guide and printed by
// `inteligir guide`. SKILL.md-shaped so an agent harness can ingest it as a
// skill verbatim. DOC-SYNC: this manual must name every CLI leaf command AND
// every flag those leaves accept —
// apps/cli/src/__tests__/guide-covers-commands.test.ts walks the real
// commander tree against these RENDERED bytes and fails on anything it does
// not mention, so adding, renaming or re-flagging a CLI command means
// updating this text in the same change (the discipline bb records in
// docs/cli-guide-and-skill.md).

export const CLI_SKILL_MD = `---
name: inteligir-cli
description: Drive the local inteligir notes app — vault files, knowledge search, agent threads — from the shell.
---

# The inteligir CLI

inteligir is a local-first notes app: a vault of markdown files with a
knowledge index and an agent. The \`inteligir\` CLI drives the running app over
its HTTP API. Every leaf command accepts \`--json\` for machine-readable
output; without it the output is compact human text.

## Finding the server

- \`INTELIGIR_SERVER_URL\` — when set (it is set inside agent shells), the CLI
  dials it directly and verifies nothing: you named it, you own it. This is
  the base URL, e.g. \`http://127.0.0.1:21847\`.
- Otherwise the CLI derives the local instance the same way the app does
  (per-checkout dev port, then the installed default), probes for it, and
  requires the server it finds to serve THIS checkout's data dir — a
  neighbouring checkout's server answering first is refused, never used.
- \`inteligir status\` prints which server was chosen, how, and which vault it
  is about to write into.
- \`INTELIGIR_THREAD_ID\` — set inside agent shells to the thread you are
  running in. \`inteligir --help\` prints both values under "Environment".

## Vault — files on disk

- \`inteligir vault list [dir]\` — list the tree (folders end with \`/\`).
- \`inteligir vault read <path>\` — print a file's content.
- \`inteligir vault write <path> [--content <text>]\` — write a file; without
  \`--content\` the content is read from stdin (UTF-8; bytes are preserved
  exactly, and anything over 10 MiB is refused). Parent folders are created.
- \`inteligir vault rename <from> <to>\` — rename/move a note; wiki links into
  it are rewritten and the old name is recorded as an alias.
- \`inteligir vault delete <path>\` — delete a file or folder.
- \`inteligir vault mkdir <path>\` — create a folder.
- \`inteligir vault status\` — git sync state (remote, dirty, conflicts).
- \`inteligir vault sync\` — run a sync against the configured remote now.

Paths are vault-relative POSIX paths (\`notes/idea.md\`). Prefer wiki links
(\`[[Note name]]\`) inside note bodies.

## Knowledge — the derived index

- \`inteligir search <query>\` — full-text search; \`tag:<name>\` terms narrow
  by tag and compose with text (\`inteligir search "tag:project deadline"\`).
  \`--limit <n>\` caps results (1–100).
- \`inteligir backlinks <path>\` — the notes linking INTO a note.
- \`inteligir tags\` — every tag with its usage count, most used first.

## Threads — the agent

- \`inteligir thread list\` — all threads with status.
- \`inteligir thread new [--doc <path> --anchor <a>] <prompt>\` — create a
  thread (optionally bound to a doc anchor) and send the first turn. \`--doc\`
  and \`--anchor\` go together. If the thread is created but its first turn
  fails, the failure names the new thread id so you can retry or archive it.
- \`inteligir thread send <id> <prompt>\` — send a follow-up; steers the
  active turn by default, \`--queue\` queues it for after the turn instead.
- \`inteligir thread show <id>\` — thread detail plus the compact timeline
  (turns, commands, file changes, messages).
- \`inteligir thread wait <id>\` — block until the thread settles. Exit code
  0 = idle, 1 = settled in error, 2 = timeout. \`--timeout <seconds>\` is a
  real wall-clock bound (default 600) and \`--poll-interval <ms>\` sets the
  poll cadence (default 300).
- \`inteligir thread archive <id>\` — archive a thread.

The spawn-and-wait loop an agent should use:

\`\`\`sh
id=$(inteligir thread new "Summarize notes/inbox.md" --json | jq -r .thread.id)
inteligir thread wait "$id" && inteligir thread show "$id"
\`\`\`

## Interactions — approvals the agent is waiting on

- \`inteligir interactions list [--thread <id>]\` — pending approval requests;
  \`--thread\` narrows to one thread.
- \`inteligir interactions answer <id> <resolution> [--thread <id>]\` — answer
  one; resolutions are \`allow_once\`, \`allow_for_session\`, or \`deny\` (a
  request may offer only some of them, and the CLI says which). \`--thread\`
  names the owning thread; omitted, it is looked up from the listing.

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
(\`not_found\`, \`invalid_request\`, …) or a CLI one otherwise
(\`invalid_usage\`, \`wait_timeout\`, \`server_unreachable\`).
`;
