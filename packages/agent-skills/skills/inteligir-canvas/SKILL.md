---
name: inteligir-canvas
description: Canvas blocks in inteligir notes — when a spatial sketch is the right answer, and the exact grid payload.
---

# inteligir Canvas

Canvas is a rough spatial surface: boxes, connectors, and relative position. It
is not a diagram renderer and not a place for readable sentences.

## When To Reach For It

Use canvas when someone asks for a canvas, edits an existing one, or wants a
sketch they can rearrange. Use a **`plaintext` code fence** for a generic flow,
wireframe, or menu sketch — ASCII stays readable everywhere, including in a diff.
Use a chart for quantity and an image for anything polished.

The test: if the words matter more than where the boxes sit, canvas is the wrong
block.

## The Payload

````markdown
```inteligir-canvas
[inteligir:grid:v2]
[inteligir:labels:[{"id":"draft","text":"Draft","col":8,"row":4}]]
....########................
....#......#................
....########................
```
````

In order: the grid marker, an optional single-line labels array, then grid rows.

The grid is 120 columns by 60 rows. Missing cells pad empty, extra cells
truncate, and a saved canvas normalizes to the full size.

**Every character except `.` and space becomes ink.** Letters do not stay
readable — an `A` is a smudge, not a letter. All readable text goes in labels.

Labels are objects with:

| Field  | Contract                             |
| ------ | ------------------------------------ |
| `id`   | Unique within this canvas, non-empty |
| `text` | Non-empty, keep under 80 characters  |
| `col`  | Integer, 0–119                       |
| `row`  | Integer, 0–59                        |

The labels line must be valid compact JSON on one line.

## Drawing Something Readable

- Count columns deliberately, or generate the rows programmatically. Hand-aligned
  ASCII drifts by one character and the whole sketch skews.
- Favor rectangles, straight connectors, and generous space.
- Do not draw arrowheads out of `<` and `>`; show direction with layout and
  labels.
- Keep strokes clear of where labels sit.
- If you cannot verify the result renders, simplify it or use an ASCII fence
  instead. A wrong canvas is harder to fix than a plain diagram.

## Before You Finish

- The block was asked for, not substituted for a diagram.
- The grid marker and labels JSON are valid and correctly ordered.
- Every coordinate is inside 120×60 and every label id is unique.
- No readable text is hiding in the grid.
