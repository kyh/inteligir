---
name: browser
description: >
  Browser automation CLI for AI agents, exposed through the built-in `browser`
  tool. Use when the user needs websites opened, pages navigated, forms filled,
  buttons clicked, screenshots taken, data scraped, web apps tested, login flows
  completed, or any other browser automation. Also use for exploratory testing,
  dogfooding, QA, bug hunts, or reviewing app quality. Prefer this tool over
  ad hoc browser automation.
---

# browser

Fast browser automation powered by the bundled `agent-browser` CLI.
Chrome/Chromium runs through CDP with accessibility-tree snapshots and compact
`@eN` element refs.

Inteligir installs the native `agent-browser` binary and browser runtime for the
user. Do not use `npm`, `npx`, or Bash. Invoke the `browser` tool.

## Tool Contract

Pass arguments exactly as they would appear after `agent-browser`.
Do not include the `agent-browser` command itself.

```json
{ "args": ["open", "amazon.com"] }
{ "args": ["snapshot", "-i"] }
{ "args": ["click", "@e2"] }
{ "args": ["fill", "@e3", "hello"] }
{ "args": ["screenshot", "--full"] }
```

Use command help when needed:

```json
{ "args": ["--help"] }
{ "args": ["open", "--help"] }
{ "args": ["screenshot", "--help"] }
```

## Start Here

Upstream's default skill tells agents to load live workflow content with
`agent-browser skills get core`. In Inteligir, use this bundled skill first:
the direct native binary may not include the upstream skills directory.

If skill discovery works, you may load matching upstream guidance through the
tool:

```json
{ "args": ["skills", "get", "core"] }
{ "args": ["skills", "get", "core", "--full"] }
```

If that returns a missing-skills error, continue with this workflow and command
help.

## Core Workflow

1. `open` a URL.
2. `snapshot` to get the accessibility tree with `@e1`, `@e2`... refs.
3. Interact via refs: `click`, `fill`, `type`, `press`, `select`, `check`, `hover`, `scroll`.
4. Re-snapshot after any DOM change. Refs are invalidated by navigation and SPA updates.

Prefer `@eN` refs over CSS selectors when a snapshot is available.
Bare domains like `amazon.com` are valid.
Screenshots are returned as both CLI output and image content.

## Useful Commands

```json
{ "args": ["open", "example.com"] }
{ "args": ["wait", "--load", "networkidle"] }
{ "args": ["snapshot", "-i"] }
{ "args": ["click", "@e2"] }
{ "args": ["fill", "@e3", "test@example.com"] }
{ "args": ["press", "Enter"] }
{ "args": ["get", "url"] }
{ "args": ["get", "title"] }
{ "args": ["screenshot"] }
{ "args": ["screenshot", "--full"] }
```

## Specialized Guidance

Upstream also ships specialized skills for Electron apps, Slack, dogfooding,
Vercel Sandbox, and AWS Bedrock AgentCore. If the user asks for one of those
flows, try the matching skill command and fall back to command help if skill
discovery is unavailable:

```json
{ "args": ["skills", "get", "electron"] }
{ "args": ["skills", "get", "slack"] }
{ "args": ["skills", "get", "dogfood"] }
{ "args": ["skills", "get", "vercel-sandbox"] }
{ "args": ["skills", "get", "agentcore"] }
```

## Why agent-browser

- Native CLI, not a Node wrapper
- Chrome/Chromium through CDP
- Accessibility snapshots with stable refs for reliable actions
- Sessions, authentication vault, state persistence, and screenshots
- One shared headed session in Inteligir
