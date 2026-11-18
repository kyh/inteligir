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
  and import say they need a connection. Why: offline copies would be most of the code.
- **A note's body is saved whole**, a second after typing stops, over the
  version its device read; a stale save merges by block, a block changed on
  both sides apart asks, and the agent's edit holds the open note. Why: a save
  is one request, with no live document to serve.
- **Each account's library is one SQLite Durable Object, its cell**, holding
  fields, folders, tags, search, links, change sets and quota; R2 holds bytes,
  D1 accounts. Why: one object guards every write.
- **One oRPC contract, and a tool is a procedure tagged `mcp.tool`**, which the
  apps, the connector and the agent call alike. Why: the agent does what the
  app does, and nothing it cannot.
- **Markdown is stock: a read keeps every letter, and a write keeps what the
  blocks mean.** Plate's plugin plus one `remark-directive` rule per custom
  block carries imports and the agent's reads and edits, and Plate's stock is
  corrected where an agent's edit would lose words. Why: byte-exact round trips
  cost more than they pay.
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
  raises, with no old-shape reader, and a Durable Object whose schema changed
  starts over empty; strike this before the first outside tester. Why: a shim
  for nobody is code every change steps around.

## Map

```
apps/web               * the one Next.js app: the site, the cloud's routes and health check; the library tab (src/library *)
apps/desktop           * the Mac app: a Tauri window on the site's /library, its origin pin, menu and updater
apps/mobile            * the iPhone app: native lists, the share sheet, the editor in an Expo DOM component
apps/extension         * the Chromium extension: Save to /v1 on the browser's own sign-in
packages/contract      * the client-safe /v1 contract and the library model every end parses
packages/service       * the cloud's code apps/web serves: its environment and accounts; each other area ports from the tag cloudflare-last
packages/db            * Postgres: accounts' tables, the drizzle client, the schema's push, local Supabase and the suites' databases
packages/editor        * the Plate editor saving a note whole, and the markdown dialect
packages/page-reader   * a saved page read into an item, over linkedom on every host
packages/client        * what the tab and the phone share above the contract: the socket, labels, the agent's threads; a waiting save, the extension's too
packages/ui            * the shared components on Base UI
tools/repo-guards      * the fitness test over the repo's product words
tools/e2e                the Playwright flows `pnpm e2e` runs, one next start and its agent per worker on its own database
```

`*` marks a `CLAUDE.md` holding the workspace's decisions. There is no local
server or command line: drive the site in a browser, the app with curl.

## Quickstart

```sh
pnpm install
pnpm bootstrap         # .env, local Postgres, its schema and the seeded login: no server needed, safe to run again
pnpm dev:web           # next dev at http://localhost:5174 (pinned)
pnpm dev               # the Mac app's window on it
```

Node 24 and pnpm 12 (`corepack enable`), no Vercel or Anthropic account, no
Docker: local Postgres is Supabase's native runtime (macOS 14+ on Apple
silicon, or Linux). The root `.env`, which bootstrap writes from
`.env.example`, is the one env file you edit (restart `pnpm dev:web` after an
edit); `pnpm db:start` writes local Postgres's URL to `.env.local`, which the
app and every script read first. Worktrees share one local Postgres on 54622:
bootstrap reuses it when it already answers. `curl localhost:5174/api/health`
answers 200 once the database does; `pnpm bootstrap --dry-run` prints the steps.

### Seeded login

```
dev@inteligir.local / password
```

`pnpm bootstrap` makes it, or `pnpm db:seed` alone after a push. Headless, a
session is one curl:

```sh
curl -s -c jar localhost:5174/api/auth/sign-in/email \
  -H 'content-type: application/json' -d '{"email":"dev@inteligir.local","password":"password"}'
```

Sign-up stays invite-only: `DEV-INVITE` opens one more account at
`/app/sign-up`, and another takes a row in `invite_code`
(`pnpm --filter @repo/db studio`). Auth allows 10 requests/60s per address, 3
per 10s on sign-in, and `/v1` 1,200 calls a minute per session; a script making
several users or looping on `/v1` sets `RATE_LIMIT_DISABLED=true` in `.env`. A reset mail lands in `pnpm dev:web`'s
log. **Never run `pnpm db:push-remote` (`@repo/db`'s `push:remote`)**: it
pushes the PRODUCTION Postgres. Drive the site with agent-browser
(`.agents/skills/agent-browser`).

## Verify a change

```sh
pnpm format:fix && pnpm verify          # typecheck, lint, knip, format, test, build; check-only
pnpm e2e                                # Playwright over the build, a next start per worker on its own database
pnpm smoke                              # the legs a deployment passes, against the app on 5174 (SMOKE_URL for a deployment)
TURBO_SCM_BASE=<base> pnpm verify:affected   # a work stream: only what it reaches
```

CI runs `verify` and `e2e` (`docs/development.md` § Quality gates), so a green
`verify` is not a green CI; a PR runs both in full on its last commit. A push to
main deploys production, which waits for CI and for `pnpm smoke` against the
deployment (`.github/workflows/smoke.yml`).

### Platform matrix

| Surface         | Dev command          | Agent-verifiable at runtime? (specs in `tools/e2e/src`)                                  |
| --------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Site and server | `pnpm dev:web`       | **Yes**: curl, `pnpm smoke`; `site`; the service's suites                                |
| Library tab     | `pnpm dev:web`       | **Once it is on Next**: `account`, `library`, `search`, `editor`, `note-links`, `saving` |
| Connector       | `pnpm dev:web`       | **Yes**: an MCP client on `/connector`, OAuth with PKCE; `connector`                     |
| Built-in agent  | `pnpm dev:web`       | **Yes, over eve's mock model**: `agent-panel`, `agent-context`                           |
| Mac app         | `pnpm dev`           | **Its shell and engine**: `cargo test`; `pnpm e2e:webkit`; the window needs a human      |
| Extension       | `pnpm dev:extension` | **In Chromium, once saving is on Next**: `extension`                                     |
| Phone           | `pnpm dev:mobile`    | **In the simulator**: its suites; `pnpm e2e:mobile` (`tools/e2e/phone`)                  |

## Rules that matter

- **`pnpm format:fix` before the gates, commit after.**
- **A change a user can notice updates `CHANGELOG.md`'s `## Unreleased`** in
  the same task, saying what to do about a behaviour that changed or went away.
- **Product surfaces speak the user's words**: never git, commit, remote, repo,
  terminal, CLI, PATH, MCP or vault; the whole is the library, what is in it
  items, an MCP server a connector. The built-in agent's instructions keep their
  words (`tools/repo-guards/src/product-words.test.ts`).
- **No `any`, no non-null `!`, no type assertions, no escape comment**: parse
  or narrow. Kebab-case filenames. Illegal states unrepresentable.
- **`@repo/contract` is client-safe and platform-neutral**: no node, react,
  server or drizzle import, and its model no `crypto` global.
- **knip is a CI gate, in one pass**: every file reachable, every export
  imported. Alone it is `pnpm turbo run //#knip`, after the extension's types.
- **The record is the decision files and GitHub Issues**, never `plans/`.
- **A large change goes as stacked PRs, one per work stream**; tooling goes alone.
- **Edit your surface's smoke list in `docs/releasing.md` § 5** for what no agent can run.

## Across workspaces

- **`/v1` breaks only behind the client build floor** (`packages/service/CLAUDE.md`).
- **The UI is `@repo/ui`'s, under the React Compiler** (`packages/ui/CLAUDE.md`,
  `tools/repo-guards/CLAUDE.md`).
- **A value has one spelling**: a key binding (`packages/editor/CLAUDE.md`), a
  preference and a library scope (`apps/web/src/library/CLAUDE.md`).
- **The library model is the contract's** (`packages/contract/CLAUDE.md`).

## Decisions

A decision is a bullet in the `CLAUDE.md` nearest its code: a bold rule, one
line of why, one path, cited as `CLAUDE.md § <its title>`. Before raising a
finding, read the declines register [#912](https://github.com/kyh/inteligir/issues/912).
