# Plan 019: Agent-queryable HTML Apps — knowledge + properties reach the broker

> Draft-quality plan (backlog): investigate-first steps are marked; refresh
> excerpts against HEAD before dispatch.

## Status

- **Priority**: P1 (the compounding move: 013 + 015 + 017 connected)
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none (015/017 merged)
- **Category**: direction (feature)
- **Planned at**: `9f5f5e94`, 2026-07-08

## Why this matters

The agent can build HTML apps (015), the vault has typed properties (017),
and the knowledge engine is agent-queryable (013) — but an HTML app can only
`list()` paths and `read()` one file at a time. "Build me a dashboard of all
notes tagged `project` sorted by due date" should be ONE broker call, not an
N+1 read loop. Close the triangle.

## Scope sketch

- Broker `list()` gains optional args: `{ query?, withProperties?, limit? }`
  — `query` runs the lexical search (`searchVault` Bridge channel), and
  `withProperties: true` returns each hit's parsed properties (core
  frontmatter helpers) alongside path/snippet. Cap results (default 50).
- New broker method `backlinks(path)` mirroring the agent tool.
- Runtime (`resources/html-app-runtime/runtime.js`): extend
  `window.inteligir.files.list` signature + add `backlinks`; the injected-deps
  set is append-only (ADR-0002) — no breaking changes to existing apps.
- Update the agent's AGENTS.md HTML-apps section with the new signatures.
- Tests: broker unit tests for query/withProperties/caps; a demo app in the
  harness fixture exercising a properties-driven table.

**Out of scope**: write-side bulk ops; semantic search; broker pagination.

## Verification

Harness demo app: table of docs filtered by a query, showing a property
column, sorted client-side. Live Electron: agent-built dashboard renders
against the real vault. Full canonical gate.

## STOP conditions

- `list()` with properties for a large vault is too heavy in one message —
  report; pagination becomes in-scope before shipping, not after.
