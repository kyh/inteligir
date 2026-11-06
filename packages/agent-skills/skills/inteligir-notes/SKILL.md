---
name: inteligir-notes
description: The dialect every item in an inteligir library is read and written in, notes and saved links alike. Read this before creating or editing any item, choosing a block, or writing a construct the editor must keep.
---

# inteligir Notes

Every item in the library, a note the person wrote or a link, an image or a PDF they saved, is a
record: its fields (title, tags, folder, the page's facts) and a body of blocks. `read_item`
answers the fields as data and the body as markdown in this dialect, and `edit_item` and
`create_note` take the same dialect back. Anything you write the editor shows as a real block, and
anything it keeps is what this section describes. Before saving, filing or tagging an item, read
inteligir Items below.

The focused sections after this one own the exact contract for the constructs that need one; they
are listed at the end of this section.

## The Rules That Never Bend

1. **An item's text is the note.** Write markdown in this dialect. Never restate an item's fields
   (its title, tags, url) in its text: they live in its fields, and `organize_items` changes them.
2. **Text round-trips.** Every construct below survives an edit unchanged. A construct spelled
   wrong does not error; it stays literal text, which is a silent failure. Follow the grammar
   exactly.
3. **Preserve what you did not come to change.** Highlight markers, formula identities, link ids
   and unfamiliar syntax all stay as found. `edit_item` changes only the passages you name, so
   name only what you mean to change.

## How An Item Reads

`read_item` answers a page of the item's text, from a block position, and the position the next
page starts at. A saved link's text has two parts: the person's own note first, then the page the
library read, between a `:::article` line and a closing `:::` line:

```text
For Tuesday: the part about owning your files.

:::article
File over app is a philosophy: if you want to create digital artifacts that last…
:::
```

The note is the person's; the article is the page as it was read, and reading the page again
replaces it. Write in the note, never in the article, and never move or remove either line.

## Choosing A Block

| You need                                          | Use                                 | Not                                          |
| ------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Prose, points, steps                              | Paragraphs, bullets, numbered lists | A table for one column of text               |
| Work with state                                   | `- [ ]` / `- [x]` checklist         | Bullets plus a status word                   |
| Values compared across rows                       | Table                               | Repeated bullets                             |
| Something set apart — context, caution, priority  | Callout                             | Bold prose                                   |
| A numeric shape or trend                          | Chart                               | A table nobody will read as a shape          |
| Peer views read one at a time                     | Tabs                                | Five headings the reader must scroll         |
| Detail most readers can skip                      | Toggle                              | A section the reader must scroll past        |
| Short blocks read side by side                    | Columns                             | A table holding paragraphs                   |
| Source, logs, literal text, ASCII diagrams        | Fenced code                         | An image of text                             |
| Rough spatial sketch with position and connectors | Canvas                              | Canvas for a generic diagram — use ASCII     |
| A styled layout no block can draw                 | HTML block                          | Rebuilding tables, tabs, or callouts in HTML |
| A passage the person should look at               | Highlight with a note               | A `TODO:` line in the text                   |
| A value reused or computed                        | Formula pill                        | Retyping the number                          |

When two fit, take the one that reads faster.

## Document Syntax

### Headings, Lists, Quotes

One `# H1` opens a note's text; sections use `##` through `####`. Checklists are `- [ ]` and
`- [x]`. Blockquotes are `>`.

```markdown
# Migration Plan

We are moving the queue first and the store after.

## Steps

- [x] Freeze the schema
- [ ] Move the queue
```

### Tables

One row per line, a consistent column count, and inline content only — links, wiki links,
emphasis, inline code, images, formula pills. Block content (lists, fences, callouts) cannot live
in a cell; put it after the table.

```markdown
| Stage | Owner | Note             |
| ----- | ----- | ---------------- |
| Queue | Ana   | [[Queue Design]] |
```

A literal pipe in a cell is `\|`. Inside a table cell, escape a pill's own pipes as `\|` (see
inteligir Formulas And Variables, In Tables).

### Code

Ordinary fences with a language tag. An unknown tag is preserved and rendered without
highlighting. Use a `plaintext` fence for ASCII diagrams.

### Callouts

A GitHub alert: a blockquote whose first line is the marker alone, then the body on `> ` lines.
The body is ordinary markdown — links and pills inside it stay live, and a bare `>` line separates
its paragraphs.

```markdown
> [!WARNING]
> Confirm the rollback path before [[Queue Design]] moves.
```

Pick the marker by what the reader must do with it:

| Marker         | For                                           |
| -------------- | --------------------------------------------- |
| `[!NOTE]`      | Context worth reading even when skimming      |
| `[!TIP]`       | A better way to do the thing                  |
| `[!IMPORTANT]` | What the reader needs to reach the goal       |
| `[!WARNING]`   | A risk that needs attention now               |
| `[!CAUTION]`   | An action whose consequences are hard to undo |

Only these five markers make an alert.

### Charts

An `inteligir-chart` fence holding JSON. Types are `bar`, `line`, `area`, and `stacked-bar`.

````markdown
```inteligir-chart
{"type":"bar","title":"Requests","data":[{"label":"Mon","value":12},{"label":"Tue","value":18}]}
```
````

One series uses `data`; several use `series`, each with a `name` and its own `data`.
`stacked-bar` takes `data` only. Every point needs a string `label` and a numeric `value`. JSON
that does not parse or does not match stays a code block — which is the failure you will see if
you guess at the shape.

### Tabs

```markdown
:::tabs
=== Draft
What we have now.

=== Shipped
What changed.
:::
```

The first thing inside `:::tabs` must be a `=== Label` line; content before it keeps the whole
block as plain text. Panels hold ordinary markdown. Reach for a table instead when the reader needs
to see all panels at once.

### Toggles

```markdown
:::toggle
The summary, shown while folded.

What opens under it: any markdown.
:::
```

The first block is the summary; everything after it folds under it.

### Columns

```markdown
:::columns
:::column
The left column.
:::

:::column 40%
The right column, resized.
:::

:::
```

Only `:::column` blocks sit inside `:::columns`. A width appears only after someone resizes a
column; never invent one.

### How `:::` Blocks Close

Tabs, toggles and columns nest inside each other, a callout, a quote or a list, and each `:::`
closes the innermost one still open. A block that never closes, or holds something its kind does
not allow, stays plain text. Leave a blank line before a `:::` that follows a list, a quote or a
table, which would otherwise read the marker as one of its own lines, and after a marker that a
`---` rule follows, which would otherwise underline the marker into a heading.

### Inline

| Form         | Syntax                                  |
| ------------ | --------------------------------------- |
| Wiki link    | `[[Note Title]]`                        |
| Date         | `@2026-08-22`                           |
| Highlight    | `<mark data-color="yellow">text</mark>` |
| Underline    | `<u>text</u>`                           |
| Tag          | `#tag`                                  |
| Formula pill | `{{2+2\|4}}`                            |

Code — inline or fenced — is inert: nothing inside it is parsed as a construct, which is how you
write an example of any syntax on this page. In prose, a backslash before a date, a pill, a
highlight marker or a `:::` line keeps it plain text: `\@2026-08-22`, `\{{2+2}}`, `\:::`.

Raw HTML beyond `<mark>`, `<u>`, and an existing preserved `<blockquote>` belongs in an
`inteligir-html` fence.

## Focused Contracts

Each is a section of this prompt, after this one:

- Structure and readability: `inteligir-writing`
- Items, saving, filing and tagging: `inteligir-items`
- An item's fields: `inteligir-fields`
- Links, embeds, files: `inteligir-links`
- Formulas and variables: `inteligir-formulas`
- Highlights and their notes: `inteligir-annotations`
- Canvas: `inteligir-canvas`
- HTML blocks: `inteligir-html`

## Before You Finish

- A new note's text opens with one H1, then the body.
- Every construct is spelled exactly as above — a callout is an alert.
- Highlight markers, formula identities and link ids you did not come to change are exactly as
  you read them.
- A saved link's article is as you read it, and you wrote only in its note.
