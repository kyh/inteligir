# Plan 020: Templates + daily notes

> Draft-quality plan (backlog): refresh excerpts against HEAD before dispatch.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature — Obsidian-migrant table stakes)
- **Planned at**: `9f5f5e94`, 2026-07-08

## Scope sketch

- **Templates**: a `templates/` folder convention (vault-local, plain notes).
  "New note from template" in the command palette lists `templates/*`;
  creating copies bytes with `{{date}}`/`{{title}}` placeholder substitution
  (tiny fixed set — no template language). Properties (017) come along for
  free since they're bytes.
- **Daily note**: palette command + keyboard shortcut → open-or-create
  `journal/YYYY-MM-DD.md` (folder + filename format configurable in a new
  Settings → Notes section, defaults above; store in ui-state/settings per
  existing patterns). If a `templates/daily.md` exists, seed from it.
- Agent synergy: mention both conventions in the agent's vault instructions
  (it can fill today's note or author templates).

**Out of scope**: template pickers with previews; periodic notes
(weekly/monthly); calendar UI.

## Verification

Harness: create-from-template flow with placeholder substitution
byte-verified; daily-note command creates then reopens the same file.
Full canonical gate.
