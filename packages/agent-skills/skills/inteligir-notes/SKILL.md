---
name: inteligir-notes
description: The persisted note syntax for inteligir vaults. Read this before creating or editing any note, choosing a block, or writing a construct the editor must round-trip.
---

# inteligir Notes

A vault is a git repository of ordinary markdown files. Every note is one `.md`
file; the app reads and writes those bytes and nothing else. Anything you write
here a person can read in a plain text editor, and anything that survives a save
is what this skill describes.

Read this first. Six focused skills own the exact contract for the constructs
that need one — they are listed at the bottom.

## The Rules That Never Bend

1. **The file is the note.** Write markdown. Do not create a database, an index,
   or a metadata file; the app owns those and keeps them outside the vault.
2. **Bytes round-trip.** Every construct below survives an open-and-save
   unchanged. A construct spelled wrong does not error — it stays literal text,
   which is a silent failure. Follow the grammar exactly.
3. **Preserve what you did not come to change.** Frontmatter keys, comment
   markers, formula identities, and unfamiliar syntax all stay as found.

## Layout

```plaintext
vault/
  Some Note.md
  Projects/Roadmap.md            # folders nest freely
  assets/diagram.png             # images and media
  .inteligir/comments/<id>.json  # a note's comments, keyed by its frontmatter id
```

The title is the filename, not a frontmatter field and not the H1. Renaming a
note renames its file, and the app rewrites the links that pointed at it.

A note's optional stable identity is frontmatter `id:`. Links may target it, so
never invent, copy, or reassign one.

## Choosing A Block

| You need                                          | Use                                 | Not                                          |
| ------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Prose, points, steps                              | Paragraphs, bullets, numbered lists | A table for one column of text               |
| Work with state                                   | `- [ ]` / `- [x]` checklist         | Bullets plus a status word                   |
| Values compared across rows                       | Table                               | Repeated bullets                             |
| Something set apart — context, caution, priority  | Callout                             | Bold prose                                   |
| A numeric shape or trend                          | Chart                               | A table nobody will read as a shape          |
| Peer views read one at a time                     | Tabs                                | Five headings the reader must scroll         |
| Source, logs, literal text, ASCII diagrams        | Fenced code                         | An image of text                             |
| Rough spatial sketch with position and connectors | Canvas                              | Canvas for a generic diagram — use ASCII     |
| Real interaction that must be clicked             | HTML block                          | Rebuilding tables, tabs, or callouts in HTML |
| A question needing an answer                      | Comment                             | A `TODO:` line in the body                   |
| A value reused or computed                        | Formula pill                        | Retyping the number                          |

When two fit, take the one that reads faster.

## Document Syntax

### Headings, Lists, Quotes

One `# H1` opens the body; sections use `##` through `####`. Checklists are
`- [ ]` and `- [x]`. Blockquotes are `>`.

```markdown
# Migration Plan

We are moving the queue first and the store after.

## Steps

- [x] Freeze the schema
- [ ] Move the queue
```

### Tables

One row per line, a consistent column count, and inline content only — links,
wiki links, emphasis, inline code, images, formula pills. Block content (lists,
fences, callouts) cannot live in a cell; put it after the table.

```markdown
| Stage | Owner | Note             |
| ----- | ----- | ---------------- |
| Queue | Ana   | [[Queue Design]] |
```

A literal pipe in a cell is `\|`. Pipes inside a complete formula pill are part
of the pill and stay as they are.

### Code

Ordinary fences with a language tag. An unknown tag is preserved and rendered
without highlighting. Use a `plaintext` fence for ASCII diagrams.

### Callouts

An `inteligir-callout` fence. The first payload line is the kind — `info`,
`warning`, or `priority`. A `priority` callout may put `low`, `medium`, `high`,
or `critical` on the second line. Everything after is the body, and the body is
ordinary markdown: links and pills inside it stay live.

````markdown
```inteligir-callout
priority
high
Confirm the rollback path before the queue moves.
```
````

Write the bare kind, not `type:` or `level:`. An unrecognized kind leaves the
block as plain code rather than becoming a callout.

### Charts

An `inteligir-chart` fence holding JSON. Types are `bar`, `line`, `area`, and
`stacked-bar`.

````markdown
```inteligir-chart
{"type":"bar","title":"Requests","data":[{"label":"Mon","value":12},{"label":"Tue","value":18}]}
```
````

One series uses `data`; several use `series`, each with a `name` and its own
`data`. `stacked-bar` takes `data` only. Every point needs a string `label` and
a numeric `value`. JSON that does not parse or does not match stays a code
block — which is the failure you will see if you guess at the shape.

### Tabs

```markdown
:::tabs
=== Draft
What we have now.

=== Shipped
What changed.
:::
```

The first thing inside `:::tabs` must be a `=== Label` line; content before it
keeps the whole block as plain text. Panels hold ordinary markdown. Reach for a
table instead when the reader needs to see all panels at once.

### Inline

| Form         | Syntax                                  |
| ------------ | --------------------------------------- |
| Wiki link    | `[[Note Title]]`                        |
| Highlight    | `<mark data-color="yellow">text</mark>` |
| Underline    | `<u>text</u>`                           |
| Tag          | `#tag`                                  |
| Formula pill | `{{2+2\|4}}`                            |

Code — inline or fenced — is inert: nothing inside it is parsed as a construct,
which is how you write an example of any syntax on this page.

Raw HTML beyond `<mark>`, `<u>`, and an existing preserved `<blockquote>`
belongs in an `inteligir-html` fence.

## Focused Contracts

- Structure and readability: `inteligir-writing`
- Frontmatter: `inteligir-frontmatter`
- Links, embeds, media: `inteligir-links`
- Formulas and variables: `inteligir-formulas`
- Comments and the sidecar: `inteligir-comments`
- Canvas: `inteligir-canvas`
- HTML blocks: `inteligir-html`

## Before You Finish

- Frontmatter (if any) opens the file, one H1 follows, then the body.
- Every construct is spelled exactly as above — no `type:` prefixes, no legacy
  fences in new content.
- Frontmatter, comment markers, and formula identities you did not come to
  change are byte-identical to what you found.
- Nothing outside the vault's `.md` files and `assets/` was created.
