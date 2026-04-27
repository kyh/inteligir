---
name: browser
description: >
  Built-in browser automation tool. Use whenever the user asks you to browse
  the web, fill forms, click around, take screenshots, scrape data, or
  interact with any website. Invoke the `browser` tool — do not reach for
  bash.
---

# browser

Drives Chrome over CDP. The tool's parameter schema documents every
available action — read it for required fields and per-action notes.

## Workflow

1. `open` a URL.
2. `snapshot` to get the accessibility tree with `@e1`, `@e2`... refs.
3. Interact via refs: `click`, `fill`, `type`, `press`, `select`, `check`, `hover`, `scroll`.
4. Re-snapshot after any DOM change — refs are invalidated by navigation and SPA updates.

Prefer `@eN` refs over CSS selectors when a snapshot is available.
Only `http:` and `https:` URLs are accepted. `evaluate` runs JS in the
page context — never pass untrusted user input directly.
