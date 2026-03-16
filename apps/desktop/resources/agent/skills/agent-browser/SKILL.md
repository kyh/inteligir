---
name: agent-browser
description: >
  Browser automation skill using the agent-browser CLI. Use this when the user
  asks you to browse the web, scrape pages, fill forms, take screenshots, or
  interact with any website. Invoke agent-browser commands via the bash tool.
---

# Browser Automation (agent-browser)

Control a headless browser via the `agent-browser` CLI using the bash tool.

## Workflow

1. Open a page: `agent-browser open <url>`
2. Get a snapshot to see what's on the page: `agent-browser snapshot`
3. Interact using refs from the snapshot (e.g. `@e1`, `@e2`):
   - `agent-browser click @e1`
   - `agent-browser fill @e3 "search query"`
   - `agent-browser press Enter`
4. Extract data: `agent-browser get text`, `agent-browser get html`
5. Screenshot: `agent-browser screenshot`
6. Close when done: `agent-browser close`

## Common Commands

- **Navigation**: `open <url>`, `goto <url>`, `back`, `forward`, `reload`
- **Interaction**: `click <selector|@ref>`, `fill <selector|@ref> <text>`, `type <selector|@ref> <text>`, `press <key>`, `hover <selector|@ref>`, `select <selector|@ref> <value>`, `check`, `uncheck`
- **Reading**: `get text [selector]`, `get html [selector]`, `get title`, `get url`, `get attr <selector> <attr>`
- **Snapshot**: `snapshot` — returns accessibility tree with @refs for precise element targeting
- **Screenshot**: `screenshot`, `screenshot --full` (full page), `screenshot --annotate` (with element labels)
- **Waiting**: `wait <selector>`, `wait --text "text"`, `wait --url "pattern"`, `wait <ms>`
- **Scrolling**: `scroll down`, `scroll up`, `scroll down 500`
- **JavaScript**: `eval "document.title"`
- **Tabs**: `tab list`, `tab new <url>`, `tab switch <index>`, `tab close`
- **Network**: `network requests`, `network route "**/*.png" --abort`
- **Cookies/Storage**: `cookies`, `storage local`, `storage session`
- **Comparison**: `diff snapshot`, `diff screenshot --baseline <file>`, `diff url <url1> <url2>`

## Element Selection

Prefer snapshot refs (@e1, @e2) for reliability. Also supports:

- CSS selectors: `agent-browser click "#submit-btn"`
- Semantic locators: `agent-browser find role button --name "Submit"`
- Text/label: `agent-browser find text "Sign in"`, `agent-browser find label "Email"`

## Tips

- Always run `snapshot` after navigation or interaction to see the updated page state
- Use `--json` flag for machine-readable output when parsing results
- Use `wait` before interacting with dynamic content
- The browser persists across commands — state is maintained between calls
