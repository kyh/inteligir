# AGENTS.md

**inteligir** is a second brain: a library of everything you save and write,
with an agent that files and edits it with you, for knowledge workers on the
web, a Mac, an iPhone and a Chromium extension. Notion is the north star:
every item is fields plus a body, and a link is an item clipped from the web.
Nobody uses it yet. It is all Cloudflare, on [kyh/init](https://github.com/kyh/init)'s
conventions; `CONTEXT.md` is the glossary and `docs/development.md` the commands.

## Project Overview

- **Every item is fields plus a body of Plate blocks**: a link its url and the
  clipped article, a file its bytes in R2, a note what you write, in Notion's
  blocks plus formulas, charts, canvas, HTML, Mermaid, tabs and columns. Why:
  one shape lets search, the agent and every surface take any item.
- **Online-first.** Devices cache what they read (TanStack Query); only a save
  from the extension or the share sheet waits offline, and editing, the agent
  and import say they need a connection. Why: offline copies were most of the code.
- **A note's body is live**: every device and the agent edit one Yjs 13.x
  document, one `y-partyserver` Durable Object per note, with no presence and
  no version history. Why: a live document removes merge logic.
- **Each account's library is one SQLite Durable Object, its cell**, holding
  fields, folders, tags, search, links, change sets and quota; R2 holds bytes,
  D1 accounts. Why: one object guards and logs every write.
- **One oRPC contract, and a tool is a procedure tagged `mcp.tool`**, which the
  apps, the connector and the agent call alike. Why: the agent does what the
  app does, and nothing it cannot.
- **Markdown is stock and lossy**, as Notion's: Plate's plugin plus one
  `remark-directive` rule per custom block carries imports and the agent's
  reads and edits. Why: byte-exact round trips cost more than they paid.
- **Saving calls no model.** The extension reads its page; any other save lands
  unread for the Worker's fill, and the agent files and tags only when asked.
  Why: a save is instant and free.
- **The built-in agent is ours, on our bill**: a Durable Object per thread on
  Sonnet 5.5 via our AI Gateway, a daily allowance, each turn one undoable
  change set; your Claude or ChatGPT joins by the connector. Why: a knowledge
  worker has no agent to install, and one they pay for should find the library.
- **Stock before custom**, in kyh/init's layout: Start routes, a zod contract
  over a service over drizzle, Better Auth, an Expo DOM editor, Playwright.
  Why: a custom piece is ours forever, so it needs a reason.
- **Dictation is the operating system's.** Why: it is already there.
- **Every feature is core, and serves saving, reading or writing or goes**: no
  tiers or flags, invite-only and free for now (1 GB, a daily agent allowance).
  Why: a feature nobody can reach is weight.
- **No users yet, so every format may change**, behind the build floor it
  raises, with no migration or old-shape reader; strike this before the first
  outside tester. Why: a shim for nobody is code every change steps around.

## Map

```
apps/web               * the one Worker: site, accounts, /v1, connector, fills, Durable Objects; the library tab (src/library *)
apps/desktop           * the Mac app: a Tauri window on the site's /library, its origin pin, menu and updater
apps/mobile            * the iPhone app: native lists, the share sheet, the editor in an Expo DOM component
apps/extension         * the Chromium extension: Save to /v1 on the browser's own sign-in
packages/contract      * the client-safe /v1 contract and the library model every end parses
packages/service       * the cloud's code: auth, /v1, connector, fills, each cell, note and conversation
packages/db            * drizzle's schemas for D1 and each object's SQLite, with their migrations
packages/editor        * the Plate editor on a note's live document, and the markdown dialect
packages/page-reader   * a saved page read into an item, over its host's DOM
packages/agent-panel   * the built-in agent's panel every device draws
packages/agent-skills    the dialect spec the agent's instructions are built from
packages/ui            * the shared components on Base UI
tools/repo-guards      * four fitness tests over the repo
tools/e2e                the Playwright flows `pnpm e2e` runs
tools/messages-fake      a scripted Claude the local Worker, the e2e and the suites run the agent on
```

`*` marks a `CLAUDE.md` holding the workspace's decisions. There is no local
server or command line: drive the site in a browser, the Worker with curl.

## Quickstart

```sh
pnpm install
cp .env.example .env   # runs unedited
pnpm dev:web           # the Worker on miniflare at http://localhost:5174 (pinned), /library included
pnpm dev               # the Mac app's window on it
```

Node 24 and pnpm 12 (`corepack enable`), no Cloudflare or Anthropic account.
The root `.env` is the one env file (restart `pnpm dev:web` after an edit); do
not reintroduce `apps/web/.dev.vars`, which wrangler reads alone. Its
`ANTHROPIC_FAKE_URL` runs the agent on a scripted Claude (`tools/messages-fake`);
a real agent needs `AGENT_GATEWAY_URL` and `AI_GATEWAY_TOKEN` naming your own gateway.

### There is no seeded login, and sign-up is invite-only

```sh
pnpm dev:web
# the local D1 file appears on the first request that touches it, so hit one, THEN push
curl -s -o /dev/null localhost:5174/api/auth/get-session
pnpm --filter @repo/db push
pnpm --filter @repo/db studio   # mint an invite: a row in `invite_code`, a fresh `code` each time
```

`/app/sign-up` and the phone take the code. Auth allows 10 requests/60s per IP;
a script making several users sets `RATE_LIMIT_DISABLED=true` in `.env`.
**Never run `@repo/db`'s `push:remote` or `studio:remote`**: both hit the
PRODUCTION D1. Drive the site with agent-browser (`.agents/skills/agent-browser`).

## Verify a change

```sh
pnpm format:fix && pnpm verify          # typecheck, lint, knip, format, test, build; check-only
pnpm e2e                                # Playwright over the built Worker; `pnpm e2e -- <file>` runs one
TURBO_SCM_BASE=<base> pnpm verify:affected   # a work stream: only what it reaches
```

CI runs `verify` and `e2e` (`docs/development.md` § Quality gates), so a green
`verify` is not a green CI; a PR runs both in full on its last commit.

### Platform matrix

| Surface         | Dev command          | Agent-verifiable at runtime? (specs in `tools/e2e/src`)                     |
| --------------- | -------------------- | --------------------------------------------------------------------------- |
| Site and Worker | `pnpm dev:web`       | **Yes**: curl; `site`, `site-faults`, `account`; the service's suites       |
| Library tab     | `pnpm dev:web`       | **Yes**: `library`, `search`, `editor`, `note-links`, `live-note`, `saving` |
| Connector       | `pnpm dev:web`       | **Yes**: an MCP client on `/connector`, OAuth with PKCE; `connector`        |
| Built-in agent  | `pnpm dev:web`       | **Over a scripted Claude**: `agent-panel`, `agent-context`                  |
| Mac app         | `pnpm dev`           | **Its shell**: `cargo test`; the window needs a human                       |
| Extension       | `pnpm dev:extension` | **In Chromium**: `extension`                                                |
| Phone           | `pnpm dev:mobile`    | **Its parts**: its suites; the app needs the simulator or a device          |

## Rules that matter

- **`pnpm format:fix` before the gates, commit after.**
- **A change a user can notice updates `CHANGELOG.md`'s `## Unreleased`** in
  the same task, saying what to do about a behaviour that changed or went away.
- **Product surfaces speak the user's words**: never git, commit, remote, repo,
  terminal, CLI, PATH or MCP; the whole is the library, what is in it items, an
  MCP server a connector. The built-in agent's instructions keep their words
  (`tools/repo-guards/src/product-words.test.ts`).
- **No `any`, no non-null `!`, no type assertions, no escape comment**: parse
  or narrow. Kebab-case filenames. Illegal states unrepresentable.
- **`@repo/contract` is client-safe and platform-neutral**: no node, react,
  server or drizzle import, and its model no `crypto` or `URL` global.
- **knip is a CI gate, in one pass**: every file reachable, every export
  imported. Alone it is `pnpm turbo run //#knip`, after the extension's types.
- **The record is the decision files and GitHub Issues**, never `plans/`.
- **A large change goes as stacked PRs, one per work stream**; tooling goes alone.
- **Edit your surface's smoke list in `docs/releasing.md` § 5** for what no agent can run.

## Across workspaces

- **`/v1` breaks only behind the client build floor** (`packages/service/CLAUDE.md`).
- **The UI is `@repo/ui`'s, under the React Compiler** (`packages/ui/CLAUDE.md`,
  `tools/repo-guards/CLAUDE.md`).
- **A value has one spelling**: a key binding, a preference, a library scope
  (`apps/web/src/library/CLAUDE.md`).
- **The library model is the contract's** (`packages/contract/CLAUDE.md`).

## Decisions

A decision is a bullet in the `CLAUDE.md` nearest its code: a bold rule, one
line of why, one path, cited as `CLAUDE.md § <its title>`. Before raising a
finding, read the declines register [#912](https://github.com/kyh/inteligir/issues/912).
