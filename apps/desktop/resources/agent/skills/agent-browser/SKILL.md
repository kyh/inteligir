---
name: browser
description: >
  Built-in browser automation tool. Use whenever the user asks you to browse
  the web, fill forms, click around, take screenshots, scrape data, or
  interact with any website. Invoke the `browser` tool.
---

# browser

Runs the bundled `agent-browser` CLI in one shared headed session.

Pass arguments exactly as they would appear after `agent-browser`:

```json
{ "args": ["open", "amazon.com"] }
{ "args": ["snapshot", "-i"] }
{ "args": ["click", "@e2"] }
{ "args": ["fill", "@e3", "hello"] }
{ "args": ["screenshot", "--full"] }
```

Use `{ "args": ["--help"] }` to discover commands.

## Workflow

1. `open` a URL.
2. `snapshot` to get the accessibility tree with `@e1`, `@e2`... refs.
3. Interact via refs: `click`, `fill`, `type`, `press`, `select`, `check`, `hover`, `scroll`.
4. Re-snapshot after any DOM change. Refs are invalidated by navigation and SPA updates.

Prefer `@eN` refs over CSS selectors when a snapshot is available.
Bare domains like `amazon.com` are valid.
Screenshots are returned as both CLI output and image content.
