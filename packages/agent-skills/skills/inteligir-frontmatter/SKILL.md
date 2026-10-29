---
name: inteligir-frontmatter
description: YAML frontmatter in inteligir notes — the only property store, what belongs there, and what must never be invented.
---

# inteligir Frontmatter

Frontmatter is an optional YAML mapping at the very top of a note, closed before
the H1. It is the **only** place note properties live: there is no metadata
database, so a field that is not here does not exist.

```markdown
---
id: 1c9a5b76-4e2d-4f4b-9a63-7e1f2b8c0d44
description: How the queue migration is sequenced.
tags:
  - migration
  - infra
status: active
---

# Migration Plan
```

## What Belongs

Fields that help someone find, group, or filter the note later — and that give
an agent structured context before it reads the body.

| Field         | For                                                                          |
| ------------- | ---------------------------------------------------------------------------- |
| `id`          | The note's stable identity. App-assigned.                                    |
| `description` | One line of what the note is                                                 |
| `tags`        | Grouping and search. Each a tag name: a letter first, no spaces; `a/b` nests |
| `status`      | A light state — `draft`, `active`, `done`, whatever the vault already uses   |
| `type`        | The kind of note — `spec`, `research`, `meeting`                             |
| `aliases`     | Other titles wiki links may resolve through                                  |

A saved item carries keys the app writes (`kind`, `url`, `site`, `author`,
`published`, `saved`, `fetched`, `fetch-error` and `description`; see
`inteligir-items`). They read like any property, but the app owns them: never
invent one, and never change `kind`, `url`, `saved` or what a page's read
wrote. A note has no `kind` key at all.

None of these are fixed enums. Reuse the values the vault already uses instead
of inventing a parallel vocabulary; a `status: in-progress` next to twenty
`status: active` notes just splits the group in two.

Unknown fields are valid and are preserved. Prefer scalars and lists of strings.
Nested structures survive but are not editable in the panel.

## What You Must Not Touch

**`id:` is the note's identity.** Wiki links and formula references point at it.
Never invent one, never copy one between notes, never edit or remove one.

The title is the **filename**. Do not add a `title:` field expecting it to win,
and do not restate frontmatter as a bold label in the body — one home per fact.

Malformed YAML is preserved exactly as written rather than repaired, because
guessing at a broken mapping loses data. Leave it unless fixing it is the task.

## Before You Finish

- Frontmatter is the first thing in the file and closes before the H1.
- It parses as a top-level YAML mapping.
- `id` and every key the app wrote are untouched; unrelated keys survived
  your edit byte for byte.
- Values reuse the vault's existing vocabulary.
- The note has no frontmatter at all if it had nothing worth recording.
