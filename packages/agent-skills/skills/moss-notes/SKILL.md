---
name: moss-notes
description: Syntax and file rules for creating or editing Moss notes under ~/Moss/Notes/. Use when authoring or modifying notes, choosing a node type, or following Moss Markdown conventions.
---

# Moss Notes

This is the canonical entry point for note layout, node selection, and core persisted syntax. Focused skills own the full contracts for frontmatter, comments, links, formulas and variables, canvas, and HTML.

## Quickstart

1. Edit the existing Markdown content file inside the note directory.
2. For a new workspace note, create `~/Moss/Notes/<Title>/<Title>.md`; never create app-owned sidecars.
3. Put optional frontmatter first, followed by one `# H1` title and then the body.
4. Start the body with a standalone takeaway, following `moss-writing-guidelines`.
5. Choose nodes with the routing table below and follow the focused skill for their exact syntax.

A **workspace note** is a canonical note bundle under `~/Moss/Notes/`. An **external note** is a Markdown file opened from another location and may use a Moss-provided sidecar path. Do not assume the workspace bundle layout for an external note.

## File Ownership

| Path                                       | Owner           | Authoring rule                             |
| ------------------------------------------ | --------------- | ------------------------------------------ |
| `<Note>/<Note>.md`                         | Note content    | Create or edit directly.                   |
| `<Note>/assets/`                           | Note media      | Add referenced note-local files here.      |
| `<Note>/comments.json`                     | Comment content | Edit only while following `moss-comments`. |
| `meta.json`, `.folder.json`, `layout.json` | Moss            | Never create or edit directly.             |

Folders and nested folders under `~/Moss/Notes/` are valid. Preserve existing frontmatter and sidecars unless the task explicitly changes them.

## Node Selection

This table owns the default selection rule. Focused skills explain how to author the selected node but do not override creation authority.

| Need                                                                        | Use                                 | Boundary                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| Prose, grouped points, or steps                                             | Paragraphs, bullets, numbered lists | Prefer the simplest readable structure.                                       |
| Execution state                                                             | Markdown checklist                  | Use `- [ ]` and `- [x]`.                                                      |
| Repeated inline attributes                                                  | Table                               | Moss Markdown tables support inline content, not nested block nodes.          |
| Peer views inspected one at a time                                          | Tabs                                | Use two to four panels unless the user asks for more.                         |
| Source, literal text, logs, or readable diagrams                            | Fenced code block                   | Generic flows and wireframes default to ASCII code.                           |
| Existing canvas, or an explicitly requested canvas/editable spatial diagram | `moss-canvas`                       | Do not create canvas for a generic diagram request.                           |
| Genuine interactive design or behavior unavailable in native nodes          | `moss-html`                         | Do not rebuild native tabs, tables, callouts, checklists, or review workflow. |
| High-signal information, warning, or priority                               | `moss-callout`                      | Keep ordinary body prose outside the callout.                                 |
| Numeric comparison or trend                                                 | `moss-chart`                        | Prefer a short table when visual shape adds no value.                         |
| Exact question, decision, approval, or review point                         | Comment                             | Fix ordinary editorial issues directly.                                       |
| Note navigation or external destination                                     | Wiki or Markdown link               | Follow `moss-links`.                                                          |
| Reused or computed inline value                                             | Variable or formula                 | Follow `moss-formulas-variables`.                                             |

## Document Syntax

### Headings And Lists

Use one H1 title. Body headings use H2-H4; avoid H5/H6.

```markdown
# Note Title

The decision is to ship the smaller first phase.

## Work

- [x] Verify the prototype
- [ ] Confirm rollout timing
```

Use `- [ ]` for open checklist items and `- [x]` for completed items.

### Tables

Keep each Markdown row on one line with a consistent number of columns.

```markdown
| Owner | Status | Reference       |
| ----- | ------ | --------------- |
| Maya  | Active | [[Launch Plan]] |
```

Cells support inline text, emphasis, links, wiki links, inline code, formulas, highlights, underline, and image Markdown. They do not support block lists, callouts, charts, code fences, or nested tables. Escape literal table separators as `\|`; pipes inside a complete formula pill remain formula syntax.

### Code

Use ordinary fenced Markdown with a language identifier. Unknown identifiers are preserved and render without bundled highlighting. Use a plain-text fence for readable ASCII diagrams.

### Charts

Use a `moss-chart` fence containing valid JSON. Supported types are `bar`, `line`, `area`, and `stacked-bar`.

Single-series shape:

````markdown
```moss-chart
{"type":"bar","title":"Requests","data":[{"label":"Mon","value":12},{"label":"Tue","value":18}]}
```
````

Multi-series `bar`, `line`, or `area` shape:

````markdown
```moss-chart
{"type":"line","series":[{"name":"Desktop","data":[{"label":"Mon","value":12}]},{"name":"Web","data":[{"label":"Mon","value":8}]}]}
```
````

`stacked-bar` uses one `data` array and does not accept `series`. Each point requires a string `label` and numeric `value`. Optional point or series colors accept `#RGB`, `#RRGGBB`, `#RRGGBBAA`, or these names: `black`, `white`, `red`, `green`, `blue`, `yellow`, `orange`, `purple`, `pink`, `brown`, `gray`, `grey`, `cyan`, `magenta`, `lime`, `navy`, `teal`, `olive`, `maroon`, `aqua`, `silver`, or `fuchsia`. Optional `options` include positive `width`/`height`, `xAxisLabel`, `yAxisLabel`, `showLegend`, `showGrid`, and palette `classic`, `accessible`, or `mono`. Invalid chart data remains code instead of becoming a chart.

### Callouts

The first payload line is `info`, `warning`, or `priority`. A priority callout may use `low`, `medium`, `high`, or `critical` on the second line.

````markdown
```moss-callout
priority
high
Confirm migration recovery before rollout.
```
````

Do not write `type:` or `level:` prefixes; Moss normalizes to the bare form.

### Tabs

```markdown
:::tabs
=== Option A
Content here.

=== Option B
Other content.
:::
```

A tabs block needs a `=== Label` header. Blank lines may precede the first header; other content before it keeps the block as plain text. Use a table instead when readers must compare all peers simultaneously.

### Quotes And Preserved HTML

Use Markdown blockquotes for authored quotations:

```markdown
> Quoted text.
```

Preserve an existing raw `<blockquote>...</blockquote>` as opaque compatibility content, such as a stored tweet embed. Do not author general raw HTML outside supported `<mark>`, `<u>`, preserved blockquotes, and `moss-html` fences.

### Inline Syntax

| Format    | Syntax                                  |
| --------- | --------------------------------------- |
| Wiki link | `[[Note Title]]`                        |
| Highlight | `<mark data-color="yellow">text</mark>` |
| Underline | `<u>text</u>`                           |

Color literals become atomic pills only in these forms: six-digit `#rrggbb`, `rgb()`/`rgba()`, and `hsl()`/`hsla()`. CSS named colors such as `rebeccapurple` remain ordinary text. Inline and fenced code remain inert.

## Focused Contracts

- Frontmatter: `moss-frontmatter`
- Comments: `moss-comments`
- Links, media, and embeds: `moss-links`
- Formulas and variables: `moss-formulas-variables`
- Canvas: `moss-canvas`
- HTML: `moss-html`

## Final Check

- The file order is optional frontmatter -> one H1 -> takeaway -> body.
- No app-owned metadata file was created or edited.
- The node choice follows the canonical routing table.
- Specialized syntax follows its focused skill.
- No placeholder media URL or duplicated metadata was introduced.
