---
name: inteligir-html
description: Self-contained HTML blocks in inteligir notes — when interaction earns one, the runtime limits, and the sandbox contract.
---

# inteligir HTML

An `inteligir-html` fence holds a complete, self-contained document rendered in
a sandboxed frame. Use it for behavior someone must click — a prototype, a state
machine, a control worth trying before the team commits to it.

**Do not rebuild what the editor already has.** Tables, tabs, callouts,
checklists, charts, and comments are real blocks: they are searchable, they
round-trip, and they work in every other markdown tool. An HTML copy of one is
a dead end.

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
reach the app or the vault. What that costs you:

- Inline CSS and JavaScript work. Start behavior on `DOMContentLoaded`.
- `localStorage`, cookies, same-origin fetches, and any parent-window API are
  unavailable. Do not design around state that outlives a reload.
- Network requests may be blocked entirely. **The first frame must be useful
  with no network and no script.**
- Vault-relative paths like `assets/x.png` do not resolve inside the frame. A
  small required image must be an inline `data:` URI. Never use `file://` or an
  absolute local path.

Every visible control must actually work and use native semantics — a button is
a `<button>`. A control that looks live and does nothing is worse than no
control.

## One Fixed Palette

The block cannot see the app's theme. Choose one self-contained palette that
reads in both light and dark surroundings: an opaque neutral background, dark
ink, restrained accents, quiet borders. Set `color-scheme` so native controls
match. Do not add a theme toggle or a `prefers-color-scheme` query — the frame
does not know what it is sitting on.

Keep the surface flush; do not draw a heavy outer frame around your own content.

## Editing And Splitting

Preserve existing behavior when you edit — the whole document is one payload, so
a careless rewrite loses working code with no diff worth reading.

If the document contains literal triple backticks, open the fence with four or
more. Give separate jobs separate fences instead of one document that does
everything.

## Before You Finish

- A real block could not have done this.
- The document is complete and self-contained.
- The first frame renders with no network and no JavaScript.
- Every control works.
- The palette is legible against both themes.
