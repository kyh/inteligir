# ADR 0001: Ephemeral vault index — no recursive watcher

Status: accepted (2026-07-08). Implementation: `plans/016-ephemeral-vault-index.md`.
Adopted from studying hubble.md's ADR-0008; the trade-offs transfer.

## Context

A recursive `fs.watch` on the vault root drove every liveness feature:
sidebar refresh, knowledge re-index, and sync kicks — one broadcast per file
event, including the app's own autosaves. Recursive watching is the scaling
hazard on large or repo-shaped vaults (`.git/`, `node_modules/`), it is why
the 2,000-entry listing cap existed (and that cap fed the sync manifest —
the plan-001 data-loss bug), and platform fallbacks (Linux non-recursive)
made behavior divergent.

## Decision

The vault listing is an **ephemeral, refreshable snapshot**, not a watched
mirror:

- One-shot crawl on demand — no recursive watcher, no cap; respects
  `.gitignore`/`.ignore` plus the hard-pruned dirs.
- The snapshot refreshes on: window focus, every app-initiated
  write/delete/rename, delegation completion, and an explicit "Refresh
  vault" command.
- Only the **currently open note** gets a watcher (single file,
  non-recursive). Its events run a pure change classifier
  (`none | reload | conflict | match`) with self-save filtering.
- Sync passes trigger on save, focus refresh, and a periodic interval —
  not on watcher events.
- `onVaultChanged` remains the renderer contract; only its sources changed.

## Considered options

- **Keep the recursive watcher, raise the cap** — treats the symptom;
  event storms and platform divergence remain.
- **Watchman / chokidar** — heavier dependency to do the thing we're
  choosing not to need.
- **Persist the snapshot between launches** — rejected for v1: rebuild on
  boot avoids stale-cache invalidation (renames, ignore-rule changes,
  version bumps).

## Consequences

- External edits to files that are NOT open appear on refocus or manual
  refresh — accepted: the user refocuses the window to look. Delegation
  results are exempted (explicit kick on completion).
- The app's own autosaves stop generating any vault-changed traffic.
- Ignore rules filter DISCOVERY, not access: explicitly opened files outside
  the snapshot still work.
- If a second window or live-collab surface ever exists, add an OPT-IN
  scoped watcher — never a recursive root watcher again.
