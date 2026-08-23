---
name: inteligir-formulas
description: Formula pills and named variables in inteligir notes — the persisted grammar, identity, bound references, and metadata.
---

# inteligir Formulas And Variables

A pill holds a computed or reusable value inline. Two fields are enough for a
one-off calculation; a name and an id make it something other pills can point at.

## The Grammar

```text
{{source|display}}
{{source|display|key=value;key=value}}
```

`source` runs to the first `|`, `display` to the second, and optional
semicolon-separated metadata follows. There is no escape form: a pipe cannot
appear inside `source` or `display`.

`display` is what the reader sees. Keep it consistent with `source` — the app
recomputes executable pills, but a stale display you wrote by hand is a lie
until something recomputes it.

| Kind                | Written as                             |
| ------------------- | -------------------------------------- |
| One-off calculation | `{{2+2\|4}}`                           |
| Named value         | `{{16\|16\|id=<uuid>;name=base_size}}` |
| Symbolic label      | `{{timeline\|6 weeks\|id=<uuid>}}`     |

## What Executes

Arithmetic only: `+ - * / ( )`, decimals, `$`, thousands commas, `%`, and
`k`/`m`/`b` magnitude suffixes in either case. No functions, no exponentiation.
Anything else is symbolic — it displays and can be referenced, but nothing
recomputes it.

Results carry thousands separators and at most two decimals. `$` and `%` shape
the parse; they do not decorate the result.

## Identity And References

A pill's identity is `(note id, pill id)`. Names live in `name=`, and a name is
only meaningful next to an `id`.

A bound reference points at an exact pill:

```text
@(name#note-id#pill-id)
```

```markdown
{{16|16|id=3f2a9d10-6c1e-4b7a-8e52-0aa1b2c3d4e5;name=base_size}}
{{@(base_size#1c9a5b76-4e2d-4f4b-9a63-7e1f2b8c0d44#3f2a9d10-6c1e-4b7a-8e52-0aa1b2c3d4e5)*2|32|id=9b8c7d6e-5f4a-4321-a098-76543210fedc;name=double_size}}
```

That is the whole point of named pills: define an anchor once, derive from it,
and changing the anchor moves everything downstream.

**Only write a bound reference when you have both real ids** — from the note's
frontmatter `id:` and the target pill's `id=`. An invented id resolves to
nothing and the pill goes stale. When you lack them, write a plain value.

Duplicating a pill inside one note keeps the id, and the copies stay linked.
An independent value needs a fresh uuid.

## Metadata

| Key       | Meaning                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| `id`      | This pill's identity within its note                                                  |
| `name`    | The name other pills reference                                                        |
| `stale=1` | The last recompute could not resolve a reference; the display is the last known value |

`stale` is the app's to set and clear. Never add it by hand, and never strip it
from a pill you are not rebuilding — it is the app telling the reader the number
may be out of date.

Unknown keys are preserved. Legacy `format=` is dropped on rewrite.

## In Tables

A pill can sit in a table cell, and its internal pipes stay pill syntax rather
than becoming column separators. Write the pill's own pipes escaped as `\|`
inside a cell so the row parses:

```markdown
| Monthly | {{1000\|1,000}} |
```

## Before You Finish

- Every new independent pill has a fresh uuid.
- Bound references use real note and pill ids, never examples from this page.
- `stale` was left exactly as found.
- Literal syntax examples are inside backticks, so they stay text.
