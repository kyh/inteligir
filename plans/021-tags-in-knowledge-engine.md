# Plan 021: `#tag` indexing in the knowledge engine

> Draft-quality plan (backlog): refresh excerpts against HEAD before dispatch.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (touches core index + markdown tokenization)
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: `9f5f5e94`, 2026-07-08

## Scope sketch

- Core: `@repo/core/knowledge` gains a tag index — inline `#tag` tokens
  (word-boundary, not inside code/links/urls) AND the frontmatter `tags`
  property (017's typed tags) feed one index: tag → paths. Decide the
  tokenizer placement with care: parse-time (markdown pipeline) beats
  regex-over-bytes; do NOT add a Plate node/kit in this plan (no editor
  rendering change — that's a follow-up).
- Surfaces: command palette lists tags (`#` prefix filter → notes with tag);
  `search_vault` agent tool and the HTML-app broker `list()` accept a
  `tag` filter (aligns with 019 if it landed).
- Index stays derived/per-device, never synced (existing law).
- Tests: core tag-index unit tests (tokenizer edge cases: code spans, urls,
  `#123` numerics excluded, unicode tags), palette integration in harness.

**Out of scope**: tag rename/refactor tooling; tag autocomplete while
typing; a tags sidebar panel; rendering `#tag` as a chip in Rich mode.

## Verification

Harness: palette `#` flow finds fixture tags from both inline and
frontmatter sources. Core tests green; full canonical gate.
