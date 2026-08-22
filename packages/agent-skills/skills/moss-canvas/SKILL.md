---
name: moss-canvas
description: Create or edit Moss canvas blocks. Use for an existing canvas or when the user explicitly asks for canvas or an editable spatial diagram; use ASCII for generic diagrams and wireframes.
---

# Moss Canvas

Canvas is a rough editable spatial surface, not a text-diagram renderer.

## Creation Authority

- Preserve and edit an existing `moss-canvas` block when the task requires it.
- Create a new canvas when the user asks for canvas or explicitly requests an editable spatial diagram.
- For a generic diagram, flow, wireframe, menu, or option sketch, use a fenced ASCII code block instead.
- Use an image for a polished static visual, a chart for quantitative shape, and HTML only for genuine interaction.

Use canvas when relative position, connectors, and rough shapes matter more than readable text in the grid. Grid characters become ink; readable words must be label metadata.

## Fence And Payload

Create new blocks with `moss-canvas`. Preserve existing legacy `moss-sketch` fences rather than renaming them incidentally.

````markdown
```moss-canvas
[moss:grid:v2]
[moss:labels:[{"id":"research","text":"Research","col":8,"row":4}]]
....########................................
....#......#................................
....########................................
```
````

This is a complete valid input. Moss accepts up to 60 grid rows of up to 120 characters, pads missing cells as empty, truncates excess cells, and normalizes a saved canvas to exactly 120 columns by 60 rows.

Payload order:

1. `[moss:grid:v2]`.
2. Optional single-line `[moss:labels:<JSON array>]`.
3. Grid rows.

Grid rules:

- `.` and spaces are empty.
- Every other character becomes filled ink; letters and box-drawing glyphs do not remain readable text.
- Coordinates are zero-based: columns `0-119`, rows `0-59`.
- Keep drawings sparse and labels clear of strokes.

Each label object requires:

| Field  | Contract                                       |
| ------ | ---------------------------------------------- |
| `id`   | Unique non-empty string within the canvas.     |
| `text` | Non-empty string; keep it under 80 characters. |
| `col`  | Integer from 0 through 119.                    |
| `row`  | Integer from 0 through 59.                     |

Use valid compact JSON on the metadata line. Do not duplicate label IDs or rely on malformed label objects being repaired.

## Reliable Authoring

- Generate large grids programmatically or count columns carefully.
- Prefer rectangles, horizontal/vertical connectors, and generous gaps.
- Do not use ASCII arrowheads to communicate direction; use layout and labels.
- Validate important canvas changes in Moss and inspect a screenshot.
- If canvas validation is unavailable, simplify the canvas or use ASCII/image Markdown. Do not substitute static HTML.

## Final Check

- Creation followed the authority rule.
- The fence and metadata are valid.
- Rows and label coordinates stay within the 120x60 grid.
- Grid text is not being mistaken for readable labels.
- The result was visually inspected when it matters.
