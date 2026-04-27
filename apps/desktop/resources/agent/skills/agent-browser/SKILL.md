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

### Navigation & interaction

| Action       | Required params          | Description                                |
| ------------ | ------------------------ | ------------------------------------------ |
| `open`       | `url`                    | Navigate the current tab to a URL          |
| `click`      | `selector`               | Click an element (@ref or CSS selector)    |
| `fill`       | `selector`, `text`       | Clear and type into a field                |
| `type`       | `text`, opt. `selector`  | Type text (into element or focused field)  |
| `press`      | `text` (key name)        | Press a keyboard key (e.g. "Enter", "Tab") |
| `hover`      | `selector`               | Hover over an element                      |
| `select`     | `selector`, `text`       | Select a `<select>` option by its `value`  |
| `check`      | `selector`, opt `checked`| Check/uncheck a checkbox (default: check)  |
| `scroll`     | opt. `direction`/`amount`| Scroll up or down (default: down 500px)    |
| `back`       | —                        | Navigate back                              |
| `forward`    | —                        | Navigate forward                           |
| `reload`     | —                        | Reload the page                            |
| `wait`       | opt. `selector`/`timeout`| Wait for element or fixed duration (ms)    |
| `close`      | —                        | Close the entire browser session           |

### Inspection

| Action       | Required params              | Description                                          |
| ------------ | ---------------------------- | ---------------------------------------------------- |
| `snapshot`   | —                            | Get accessibility tree with @refs                    |
| `screenshot` | opt. `fullPage`              | PNG screenshot                                       |
| `get_text`   | opt. `selector`              | Get text content of page or element                  |
| `get_url`    | —                            | Get current page URL                                 |
| `get_title`  | —                            | Get current page title                               |
| `evaluate`   | `script`, opt. `timeout`     | Run JavaScript in the page (30s default timeout)     |

### Cookies & storage

| Action          | Required params             | Description                                     |
| --------------- | --------------------------- | ----------------------------------------------- |
| `cookies_get`   | —                           | List all cookies (`name=value\tdomain\tpath`)   |
| `cookies_set`   | `name`, `value`, opt `domain`| Set a cookie on the current page's URL          |
| `cookies_clear` | —                           | Delete every cookie                             |
| `storage_get`   | opt. `name`                 | Read a localStorage key, or all keys if omitted |
| `storage_set`   | `name`, `value`             | Write a localStorage key                        |
| `storage_clear` | —                           | Clear localStorage for the current origin       |

### Network

| Action         | Required params | Description                                                       |
| -------------- | --------------- | ----------------------------------------------------------------- |
| `network_log`  | opt. `filter`   | Recent requests (status / method / type / URL). Ring-buffered ~200 |

### Tabs

| Action       | Required params         | Description                                                       |
| ------------ | ----------------------- | ----------------------------------------------------------------- |
| `tab_list`   | —                       | List open tabs. Current tab marked with `*`                       |
| `tab_new`    | opt. `url`, `label`     | Open a new tab and switch to it                                   |
| `tab_switch` | `tabId`                 | Switch the current tab (use `tabId` from `tab_list`, e.g. `t2`)   |
| `tab_close`  | opt. `tabId`            | Close a tab. Defaults to the current tab                          |

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
- The `select` action matches by the `<option>` `value` attribute, not the visible label.
- `network_log` only shows requests since the tab was opened. Use `filter` to narrow by URL substring.

## Known Limitations

- **Shadow DOM**: The `fill`, `select`, and `check` actions use native prototype
  setters to work with React/Vue controlled inputs, but cannot reach inputs
  inside Web Component shadow DOM. Use `evaluate` to interact with shadow roots.
- **Full-page screenshot cap**: Full-page screenshots are capped at 1280×16384
  pixels to avoid excessive memory usage on very tall pages.

## Security

- Only `http:` and `https:` URLs are allowed. `file://`, `javascript:`, and
  `data:` schemes are blocked.
- The `evaluate` action runs arbitrary JavaScript in the page context. Avoid
  passing untrusted user input directly into scripts. Prefer structured actions
  (click, fill, get_text) when possible.
