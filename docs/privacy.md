# Private notes (`private: true`)

Add `private: true` to a note's YAML frontmatter (Page details → the
`private` checkbox, or the palette's "Mark note as private") and the note is
**excluded from AI features on this device**. A lock badge in the header
shows the state.

This is a **leak-prevention boundary for AI features, not a security
boundary**. Read the "What it does NOT do" list before relying on it.

## What it does

- **Agent file tools refuse it.** `read`, `edit`, and `write` on a private
  note are blocked before they run (pi's `tool_call` hook,
  `packages/features/src/server/agent/privacy/`) with a structured "this note
  is private" error the model sees. The check probes the file's frontmatter
  on disk **per call** — never a cached index — and applies to both the chat
  agent and the background delegation agent. `grep`/`find`/`ls` (not active
  today) are gated defensively: a scan of any folder containing a private
  note refuses entirely.
- **`search_vault` / `get_backlinks` drop it entirely.** Private notes are
  excluded inside the index query and every surviving hit is re-probed
  against live disk — no path, no title, no snippet ever reaches the model.
  A private note's backlinks read as "No backlinks.", indistinguishable from
  a note that has none.
- **Editor AI is hard-off.** Ghost-text stops and the ⌘J menu (prompts,
  canned actions, translate) refuses with a toast, derived live from the
  document — the instant you type `private: true`, before any save. This
  wins over the ghost-text on/off setting.
- **The chat context hint omits it.** A fresh chat turn normally tells the
  agent which note is open; for a private note even the path is withheld.
- **Delegation refuses it.** "Delegate" on a checkbox inside a private note
  fails with an explicit error, at creation and re-checked at dispatch.
- **Fail-closed defaults.** Frontmatter that can't be parsed (malformed
  YAML, duplicate keys) is treated as private by every AI path; an
  unreadable file, an unresolvable vault root, or a crashing privacy probe
  all block rather than allow. (The UI shows no lock for malformed
  frontmatter — only a real `private: true` does.)

## What it does NOT do

- **`bash` can still read it.** The agent keeps raw shell access by design.
  We block a command that literally names a private note's path, and
  AGENTS.md instructs the model never to work around a privacy refusal — but
  `cat ./vault/*.md`, pipes, and subshells are not (and cannot soundly be)
  parsed. Real closure needs a sandbox; until then this is instruction, not
  enforcement. The same applies to `execute` (sandboxed TypeScript with fs
  access via the executor), `browser`, and `peekaboo` — and peekaboo can
  screenshot a private note that is open on your screen.
- **Filenames still leak to the shell.** `bash ls vault/` shows private
  notes' names; only the knowledge tools hide paths.
- **Sync uploads it unencrypted.** Vault sync (off by default) mirrors
  private notes to the sync server exactly like any other file — the flag
  provides no server-side protection. Excluding them from sync would be
  worse (silent data loss on other devices), so we sync and say so.
- **Chat paste is not covered.** Content you paste into the chat composer,
  or copy into a public note, is out of scope by definition.
- **HTML Apps can read it.** The `window.inteligir.files` broker does not
  filter private notes (single-user vault; apps are user/agent-authored).
  Re-audit before any sharing feature ships.
- **Transcripts record refusals.** A blocked tool call persists the path the
  model typed plus the refusal string in `~/.inteligir/sessions/*.jsonl` —
  never the note's content. Content a `bash` bypass obtained WOULD land in
  the transcript (the hole above).

## Mechanics

- The flag is plain frontmatter — the file is the only store; it syncs as
  bytes and any editor can set it. Strict typing per the properties panel:
  only a boolean `true` counts (`yes` / `"true"` stay text and read public).
- The knowledge index persists an `is_private` column (default 1 = private
  until parsed) and agent-facing search filters inside the SQL query; the
  gate and the knowledge port still re-probe live disk on every call, so the
  index is only ever a prefilter.
- Enforcement points, for review: `agent/privacy/gate.ts` (tool gate);
  `lib/agent-knowledge-port.ts` (search/backlinks); `editor/note-privacy.ts`
  with `ai/ghost-text-kit.tsx` and `ai/ai-session.ts` (editor AI);
  `stores/agent-store.ts` (context hint); `delegation/delegation-manager.ts`
  (delegation).
