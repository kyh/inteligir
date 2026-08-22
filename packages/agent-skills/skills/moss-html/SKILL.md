---
name: moss-html
description: Author self-contained moss-html blocks for genuine interactive design artifacts, embedded HTML previews, prototypes, and behavior demonstrations that native Moss nodes cannot represent.
---

# Moss HTML

Use `moss-html` only for a genuine interactive design artifact or browser behavior that native Moss nodes cannot represent. Do not rebuild native tabs, tables, callouts, checklists, charts, comments, or review workflow. Keep requirements and review instructions in native Markdown.

## Complete Shell

````markdown
```moss-html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="moss-html-version" content="v1">
<style>
  * { box-sizing: border-box; }
  :root {
    color-scheme: light;
    --artifact-surface: rgb(253 250 246);
    --artifact-ink: rgb(72 67 60);
    --artifact-line: rgb(215 211 201);
    --artifact-accent: rgb(57 112 77);
  }
  body {
    width: 1200px;
    min-height: 900px;
    margin: 0;
    background: var(--artifact-surface);
    color: var(--artifact-ink);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .artifact { min-height: 900px; padding: 32px; }
</style>
</head>
<body>
  <main class="artifact"><!-- interactive artifact --></main>
</body>
</html>
```
````

Use a plain `moss-html` fence line; dimensions belong in the document CSS, not the fence.

## Runtime Contract

- The preview runs from an isolated data URL.
- Inline CSS and JavaScript are supported. Initialize behavior with `DOMContentLoaded`.
- `localStorage`, `sessionStorage`, cookies, same-origin fetches, parent/window APIs, and Moss internals are unavailable or unreliable.
- Note view shows a static screenshot before activating the live iframe. Make the initial state useful without JavaScript or network access.
- Set `width` and `height` or `min-height`; otherwise Moss uses 1200x900.
- Multiple jobs belong in separate focused fences.
- A visible button, tab, checkbox, filter, menu, or form control must work and use native semantics.

## Images And Dependencies

Workspace-relative asset paths do not resolve inside the HTML data URL. For a small required image, embed a self-contained data URL such as `src="data:image/png;base64,..."`; keep payload size reasonable. Remote images, fonts, scripts, and fetches may fail and must not be required for the first frame or core interaction.

Do not use `file://`, absolute local paths, Moss internal URLs, or placeholder image URLs.

## One Theme-Neutral Design

HTML nodes do not know the surrounding Moss theme. Use one fixed self-contained palette that remains legible in both light and dark Moss modes.

- Keep the canvas flush with the node; do not add a black or graphite outer frame.
- Use an opaque neutral surface, dark readable ink, restrained Moss-green accents, and subtle internal borders or shadows.
- Set `color-scheme` for native controls.
- Do not add a theme toggle or light/dark media query for the surrounding app.
- Do not use emojis as interface icons.

## Preservation And Validation

- Keep `<meta name="moss-html-version" content="v1">`.
- If the document contains literal triple backticks, wrap the outer fence with four or more backticks.
- Preserve existing behavior and self-contained dependencies when editing.
- Activate the iframe and test every visible control. Inspect the static first frame, live state, and fullscreen state when relevant.

## Final Check

- Native Moss nodes could not represent the artifact's interaction.
- The HTML is complete and self-contained.
- The first frame works without network or script execution.
- Every visible control behaves correctly.
- The fixed palette is readable in either Moss mode without a dark outer frame.
