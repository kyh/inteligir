---
name: inteligir-html
description: Self-contained HTML blocks in inteligir notes — when a drawn document earns one, the frame's limits, and the sandbox contract.
---

# inteligir HTML

An `inteligir-html` fence holds a complete, self-contained document drawn in a
sandboxed frame, with script off. Use it for what only a page's own layout can
show — a mock-up of a screen, a styled comparison, a layout worth seeing before
the team commits to it.

**Do not rebuild what the editor already has.** Tables, tabs, toggles,
columns, callouts, checklists, charts, and annotations are real blocks: they are
searchable, they round-trip, and they read as text in every other markdown
tool. An HTML copy of one is a dead end.

## The Shell

````markdown
```inteligir-html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: light; }
  body {
    width: 900px;
    min-height: 560px;
    margin: 0;
    padding: 28px;
    background: #fbfbfa;
    color: #1f1f1f;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
</style>
</head>
<body>
  <main><!-- the artifact --></main>
</body>
</html>
```
````

Size belongs in the document's CSS, not on the fence line.

## The Sandbox

The frame is isolated, and that is the point — a note should never be able to
reach the app or the library. What that costs you:

- Inline CSS works; script never runs. The reader sees the document as its
  HTML and CSS draw it, so a `<script>` is dead weight.
- Forms, `localStorage`, cookies and any parent-window API are unavailable.
- Network requests are blocked: no remote stylesheet, image or font. **The
  document must be complete with no network and no script.**
- A library file's address, `assets/<sha>`, does not resolve inside the frame.
  A small required image must be an inline `data:` URI. Never use `file://` or
  an absolute local path.

What a reader can do is what HTML and CSS do alone: open a `<details>`, hover,
tick a checkbox a `:checked` rule answers. A control that looks live and does
nothing is worse than no control, so draw none that would need script.

## One Fixed Palette

The block cannot see the app's theme. Choose one self-contained palette that
reads in both light and dark surroundings: an opaque neutral background, dark
ink, restrained accents, quiet borders. Set `color-scheme` so native controls
match. Do not add a theme toggle or a `prefers-color-scheme` query — the frame
does not know what it is sitting on.

Keep the surface flush; do not draw a heavy outer frame around your own content.

## Editing And Splitting

Preserve what is there when you edit — the whole document is one payload, so a
careless rewrite loses work with no diff worth reading.

If the document contains literal triple backticks, open the fence with four or
more. Give separate jobs separate fences instead of one document that does
everything.

## Before You Finish

- A real block could not have done this.
- The document is complete and self-contained.
- It renders with no network and no script.
- Every control it draws works without script.
- The palette is legible against both themes.
