---
name: moss-formulas-variables
description: Create or edit Moss formulas and variables, including UI entry, persisted Markdown, linked instances, derived values, bound references, IDs, and stale metadata.
---

# Moss Formulas And Variables

Use formulas for one-off numeric expressions and variables for named values that should be reused or referenced.

## Editor Entry

In the editor:

- `=2+2` creates an unnamed executable formula.
- `sum=2+2` creates a named executable variable.
- `time=9am` or `window_1=9am-930am` creates a named symbolic variable.

Variable names start with a letter and contain only letters, digits, `_`, or `-`. Symbolic values may contain punctuation and non-Latin text. A value is executable only when it is a supported numeric expression or contains a bound reference.

## Persisted Markdown

The persisted grammar is:

```text
{{source|display}}
{{source|display|key=value;key=value}}
```

`source` ends at the first `|`, `display` ends at the second `|`, and optional semicolon-separated metadata follows. Pipes are unsupported inside `source` or `display`; there is no escape form.

| Kind                      | Persisted example |
| ------------------------- | ----------------- |
| One-off formula           | `{{2+2            | 4}}`  |
| Symbolic variable         | `{{time           | 9am   | id=6ff0a3b9-16b8-4394-bc11-bc9c1ba2d3f8}}`             |
| Named executable variable | `{{5000           | 5,000 | id=ff796681-9dd9-49de-bd28-85a116d07236;name=budget}}` |

Moss may read a symbolic variable without an ID for compatibility, but new or rewritten symbolic variables should persist one. Anonymous executable formulas retain the two-field form and do not require persisted identity metadata.

Supported executable syntax is `+ - * / ( )`, decimals, `$`, thousands commas, `%`, and numeric `k`/`m`/`b` suffixes. Functions and exponentiation are unsupported. Results use thousands separators and at most two decimal places; currency and percent characters affect parsing but do not decorate the result.

## Identity And Linked Instances

Moss identifies a variable by `(noteId, id)`.

- Copying and pasting a variable within the same note preserves its ID and creates another linked instance.
- Editing the name or value of any linked instance updates every instance with that ID in the note.
- Create an independent variable by entering a new `name=value`; Moss assigns a new ID.
- The same ID in another note is independent because the note ID differs.
- When directly duplicating a variable in the same note, preserve the ID only when the duplicate should remain linked. Generate a fresh UUID for a newly created independent variable.

## Bound References

A bound reference is `@(name#note-id#formula-id)`. It is executable and points to an exact variable identity.

```markdown
{{28|28|id=b371c6db-70db-48f1-99e2-9ea1ef6f1151;name=h1_size}}
{{@(h1_size#9e64c3df-c1e2-4a4d-8c07-91528f422413#b371c6db-70db-48f1-99e2-9ea1ef6f1151)-6|22|id=c520e764-a784-48c5-81ca-f93ac6f4ad37;name=h2_size}}
```

Create a bound reference only when the real containing note ID and target formula ID are supplied by Moss context or existing persisted metadata. Never substitute example IDs, guess an ID from a path, or edit app-owned metadata. When exact IDs are unavailable, use the editor's variable typeahead or leave the relationship unbound.

## Metadata

Supported metadata is:

| Key       | Meaning                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | Formula or variable identity within its containing note.                                                                                       |
| `name`    | Name of an executable variable; symbolic variables derive their name from `source`.                                                            |
| `stale=1` | Moss could not recompute a bound expression because a reference is missing or cyclic, so the displayed numeric result is the last known value. |

Treat `stale=1` as app-maintained state: preserve it unless the expression is deliberately rebuilt, and do not add it manually. Legacy `format=...` metadata is accepted but ignored; remove it when rewriting the pill.

## Tables And Preservation

Formula pills may appear inside a one-line Markdown table row. Their internal pipes are formula syntax and do not become table separators.

- Preserve existing IDs, names, references, and stale state unless the task changes that relationship.
- Keep pills inline; do not use them for multiline calculations or chart data.
- Wrap literal examples in backticks so they do not become live pills.

## Final Check

- Editor-entry syntax is not confused with persisted Markdown.
- Every new independent variable has a fresh UUID.
- Linked same-note instances share an ID and therefore update together.
- Bound references use real note and formula IDs.
- App-maintained stale state was preserved rather than invented.
