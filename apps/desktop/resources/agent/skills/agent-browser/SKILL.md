---
name: browser
description: >
  Built-in browser automation tool. Use this when the user asks you to browse
  the web, scrape pages, fill forms, take screenshots, or interact with any
  website. Invoke via the browser tool (not bash).
---

# Browser Automation

Control a built-in browser using the `browser` tool. No external CLI or
installation required.

## Workflow

1. Open a page: `browser({ action: "open", url: "https://example.com" })`
2. Get a snapshot to see interactive elements: `browser({ action: "snapshot" })`
3. Interact using @refs from the snapshot:
   - `browser({ action: "click", selector: "@e1" })`
   - `browser({ action: "fill", selector: "@e3", text: "search query" })`
   - `browser({ action: "press", text: "Enter" })`
4. Extract data: `browser({ action: "get_text" })` or `browser({ action: "get_text", selector: "@e2" })`
5. Screenshot: `browser({ action: "screenshot" })` or `browser({ action: "screenshot", fullPage: true })`
6. Close when done: `browser({ action: "close" })`

## Actions

| Action       | Required params          | Description                                |
| ------------ | ------------------------ | ------------------------------------------ |
| `open`       | `url`                    | Navigate to a URL                          |
| `click`      | `selector`               | Click an element (@ref or CSS selector)    |
| `fill`       | `selector`, `text`       | Clear and type into a field                |
| `type`       | `text`, opt. `selector`  | Type text (into element or focused field)  |
| `press`      | `text` (key name)        | Press a keyboard key (e.g. "Enter", "Tab") |
| `hover`      | `selector`               | Hover over an element                      |
| `select`     | `selector`, `text`       | Select a `<select>` option by its `value` attribute |
| `check`      | `selector`, opt `checked`| Check/uncheck a checkbox (default: check)  |
| `snapshot`   | —                        | Get accessibility tree with @refs          |
| `screenshot` | opt. `fullPage`          | Take a PNG screenshot                      |
| `get_text`   | opt. `selector`          | Get text content of page or element        |
| `get_url`    | —                        | Get current page URL                       |
| `get_title`  | —                        | Get current page title                     |
| `evaluate`   | `script`, opt. `timeout` | Run JavaScript in the page (30s default timeout) |
| `wait`       | opt. `selector`/`timeout`| Wait for element or fixed duration (ms)    |
| `scroll`     | opt. `direction`/`amount`| Scroll up or down (default: down 500px)    |
| `back`       | —                        | Navigate back                              |
| `forward`    | —                        | Navigate forward                           |
| `reload`     | —                        | Reload the page                            |
| `close`      | —                        | Close the browser                          |

## Element Selection

Prefer snapshot refs (`@e1`, `@e2`) for reliability — they map to the
interactive elements shown in the accessibility tree. Also supports CSS
selectors like `#submit-btn` or `.search-input`.

## Tips

- Always run `snapshot` after navigation or interaction to see the updated page state
- The browser persists across calls — state, cookies, and sessions are maintained
- Use `wait` with a selector before interacting with dynamic content
- Use `evaluate` for complex DOM operations the other actions don't cover
- To get raw HTML instead of text, use `evaluate` with
  `document.documentElement.outerHTML` (full page) or
  `document.querySelector("...").innerHTML` (specific element)
- The `evaluate` action only captures synchronous return values. If your script
  returns a Promise, wrap it so the final value is returned (e.g. `await fetch(...).then(r => r.text())`).
  Unhandled async rejections inside evaluated scripts are not captured — the
  action will return the synchronous result while the error logs to the console.
  Note: timed-out scripts continue running in the page context until navigation or close.
- The `select` action matches by the `<option>` `value` attribute, not the visible label.
  Run `snapshot` or `evaluate` to inspect option values if the visible text differs.

## Security

- Only `http:` and `https:` URLs are allowed. `file://`, `javascript:`, and
  `data:` schemes are blocked.
- The `evaluate` action runs arbitrary JavaScript in the page context. Avoid
  passing untrusted user input directly into scripts. Prefer structured actions
  (click, fill, get_text) when possible.
