# AGENTS.md

**inteligir** is a second brain: a library of everything you save and write,
with an agent that files and edits it with you. Notion is the north star.
Every item is a page, and a bookmark is a page clipped from the web:
bookmarks are how things come in, and notes are how you work on them. It is
for general knowledge workers, not developers, on the web, a Mac, an iPhone
and a Chromium extension, and nobody uses it yet. Everything we host is
Cloudflare, built on the conventions of the owner's template,
[kyh/init](https://github.com/kyh/init), with Cloudflare in place of its
Vercel stack.

This is the root guide for every coding agent; `CLAUDE.md` imports it. Each
workspace's durable decisions live in a `CLAUDE.md` beside its code
(§ Decisions), `CONTEXT.md` is the domain glossary, `docs/development.md` owns
the commands, the ports and where state lives, and `docs/releasing.md` is the
owner's release runbook.

## Project Overview

The premises every change builds from, each with its reason.

**The code is in transit.** PR [#907](https://github.com/kyh/inteligir/pull/907)
is moving the code to these premises in stages, issues
[#926](https://github.com/kyh/inteligir/issues/926) to
[#936](https://github.com/kyh/inteligir/issues/936) (label `plan`), all on that
PR's branch by the owner's decision. Until a stage lands, the code, § Map
onward and the `CLAUDE.md` bullets of its area may describe the older design
(offline replicas, a byte-exact codec, our own agent loop). Where they
disagree, these premises win, and the stage's issue says what changes.

- **Every item is a page: properties plus a body of Plate blocks**, as in
  Notion.
  - A link is a page whose properties hold its url and site, and whose body
    holds the clipped article.
  - An image or PDF is a page naming its file, kept in R2.
  - A note is a page you write.
  - The blocks are Notion's set plus formulas, charts, canvas, HTML, Mermaid,
    tabs and columns.
  - Why: one shape lets search, the agent and every surface work on every item.
- **Online-first.** The cloud is the truth. Devices cache what they read
  (TanStack Query), and only a save from the extension or the phone's share
  sheet waits offline. Editing, the agent and import need a connection,
  and say so. Why: offline copies on three platforms were most of
  the code and little of the product.
- **A note's body is live**, like Google Docs. You on every device and the
  agent edit one Yjs document at once: one `y-partyserver` Durable Object per
  note, `@platejs/yjs` in the editor, Yjs pinned to 13.x. There is no presence
  and no page history. Why: a live document removes merge logic instead of
  adding it.
- **Each account's library is one SQLite Durable Object, its cell.**
  - It holds properties, folders, tags, full-text search, links, change sets
    and the account's quota.
  - A note's object pushes its title, text and links to the cell on a
    debounced save.
  - R2 holds the bytes, and D1 the accounts.
- **One oRPC contract, and a tool is a procedure tagged `mcp.tool`.** The apps,
  the connector and the built-in agent call the same procedures, guarded the
  same way. Why: the agent should do what the app does, and nothing the app
  cannot.
- **Markdown is stock and lossy**, as Notion's is. It is how a library comes in
  and goes out, and how the agent reads and edits it.
  - Plate's markdown plugin, with one `remark-directive` rule per custom block.
  - Page links are stock mentions.
  - Unknown syntax lands as text.
  - Why: byte-exact round trips cost more than they were worth.
- **Saving calls no model.** The extension reads the page it is on, and every
  other save lands at once as an unread item that the Worker's fill reads. The
  agent files, tags and summarizes only when asked. Why: a save should be
  instant and free.
- **The built-in agent is ours, on our bill, and the user's own Claude or
  ChatGPT reaches the same library through the connector.**
  - The built-in agent: one Durable Object per conversation, on Sonnet 5.5,
    through our AI Gateway, held to a daily allowance per account with the
    gateway's spend limit behind it.
  - Each turn is one undoable change set. Undo takes back only the agent's
    changes and keeps yours.
  - A connected assistant signs in with OAuth on our consent page and makes no
    model call of ours.
  - Why: a knowledge worker has no agent to install, and one they already pay
    for should find the library where it already looks.
- **Stock before custom.** TanStack Start serves every route. A contract
  package (zod) feeds a service package (procedures, auth, Durable Objects),
  over a db package (drizzle on D1 and on each object's SQLite), as in
  kyh/init. Better Auth handles every sign-in, the phone's editor is an Expo
  DOM component, and Playwright runs the end-to-end tests. Why: a custom piece
  is code we own forever, so it needs a reason the stock one fails.
- **No product surface says git, commit, remote, repo, terminal, CLI, PATH or
  MCP**, because none of those words is the user's. The connector is what
  Claude itself calls an MCP server.
- **Dictation is the operating system's**, because the Mac's and the phone
  keyboard's are already there.
- **Every feature is core, and serves saving, reading or writing or goes.** No
  tiers and no flags. For now access is invite-only and free: 1 GB of storage
  and a daily agent allowance, with no payments.
- **No users yet, so every format may change.** Nobody but the owner holds an
  install, and a shim kept for nobody is code every later change steps around.
  - Change any wire, row or database format freely.
  - Write no migration, no reader for an older build's shape, no retired-path
    sweep and no legacy-name warning.
  - The wire may break, behind the client build floor the same change raises.
  - A decision bullet or a declines-register line that keeps a shape for an
    older install yields to this.
  - The first outside tester ends the premise: strike this bullet before their
    first build, and from then on a format change migrates.

**Four surfaces over one Worker** (the target):

- `apps/web` is the Worker, a TanStack Start app. It serves the site, accounts,
  the library's pages, oRPC, the connector and the queue that reads saved
  pages. It runs each account's cell, each note's live document and each
  conversation's agent.
- `apps/desktop` is a Tauri shell loading the hosted site, with the stock
  updater.
- `apps/mobile` is the Expo iPhone app: native lists and the share sheet, with
  the editor in an Expo DOM component.
- `apps/extension` is WXT: Save from the browser.

There is no local server and no command line. A coding agent drives the
product the way a person or an assistant does: the site in a browser, the
Worker with curl, the library through the connector.

**The decision record** is the stage issues above, then GitHub issues
[#889](https://github.com/kyh/inteligir/issues/889),
[#611](https://github.com/kyh/inteligir/issues/611) and
[#542](https://github.com/kyh/inteligir/issues/542), and the declines register
[#912](https://github.com/kyh/inteligir/issues/912). The later wins where two
disagree. Where any of them assumes a local server, markdown files on disk,
git, offline replicas, a byte-exact codec or an agent on the user's own plan,
this guide wins.

## Map

```
apps/web                @repo/web — ONE Cloudflare Worker: site, accounts, /v1, the connector, fills, each account's library cell, each conversation with the built-in agent
apps/workspace          @repo/workspace — the SPA: the Mac app's window, and the browser tab at /library
apps/desktop            @repo/desktop — THE MAC APP: the Tauri window around the SPA; the replica, credential and file cache in Rust
apps/mobile             @repo/mobile — the iPhone app: the library in the editor page, over its own replica, offline
apps/mobile-editor      @repo/mobile-editor — the phone's editor page: @repo/editor as one script behind a WebView bridge
apps/extension          @repo/extension — the Chromium extension: toolbar and right-click Save to /v1, with its own credential
packages/domain         @repo/domain — zod-only leaf vocabulary
packages/contract       @repo/contract — ONE client-safe contract for /v1: the library and the account
packages/notes          @repo/notes — the pure, platform-neutral domain: the library model, its SQL, search and links
packages/editor         @repo/editor — the Plate WYSIWYG, and the markdown codec over its headless kits
packages/editor-bridge  @repo/editor-bridge — the phone editor page's wire, which the page and the phone both parse
packages/page-reader    @repo/page-reader — a saved page read into an item, over the DOM its host hands it
packages/library-replica @repo/library-replica — the replica engine every device runs: the pull, the outbox and its sync, over the host's SQLite
packages/agent-panel    @repo/agent-panel — the built-in agent's panel as every device reads it: a conversation's events, approvals, Undo and sends
packages/agent-skills   @repo/agent-skills — the dialect spec the built-in agent's instructions are built from
packages/ui             @repo/ui — the shared component vocabulary on Base UI
tools/repo-guards       @repo/repo-guards — fitness tests over the repo itself
tools/e2e               @repo/e2e — the scenario suite `pnpm e2e` runs
tools/ui-gallery        @repo/ui-gallery — the @repo/ui gallery `pnpm dev:gallery` serves, never deployed
tools/messages-fake     @repo/messages-fake — a scripted Claude Messages API with no model, which the local Worker, the e2e and the suites run the built-in agent against
```

The replica engine is `@repo/library-replica`, pure as `@repo/notes` is.
Turborepo + pnpm, oxlint/oxfmt, vitest, knip. The site is TanStack Start,
React 19 and Tailwind 4 on the Worker; auth is Better Auth on D1 (email and
password, invite-gated, no social providers); the library cell is a SQLite
Durable Object, the bytes are in R2, saved pages are read off a Queue, OAuth
is `@cloudflare/workers-oauth-provider` on KV, and each conversation's object
calls Claude with `@anthropic-ai/sdk` through AI Gateway, woken by
`agents/lifecycle`. The Mac is Tauri 2; the phone is
Expo, shipped to TestFlight by EAS. The workspaces' READMEs own their layouts
and loops; `apps/web/README.md` has the Worker's routes and deploy,
`docs/privacy.md` what each device sends and where.

## Quickstart

```sh
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET to anything
pnpm dev:web         # THE CLOUD: the real Worker on miniflare, http://localhost:5174 (pinned):
                     #   the site, accounts, /v1, the connector, every library cell,
                     #   and the library in a browser tab at /library
pnpm dev             # the Mac app's window over that Worker
```

No bootstrap script, and no Cloudflare or Anthropic account. Node 24 and pnpm
12 (`corepack enable`; `.codex/environments/environment.toml` runs `pnpm i` for
cloud runners).

The local Worker's built-in agent talks to a scripted Claude
(`tools/messages-fake`, which `pnpm dev:web` serves), chosen by
`ANTHROPIC_FAKE_URL`, a dev-only binding the example `.dev.vars` sets: no key,
no model, and the mode every e2e scenario runs. A real agent needs an AI
Gateway of your own in its place, `AGENT_GATEWAY_URL` and `AI_GATEWAY_TOKEN`
naming one in your own Cloudflare account that holds your own Anthropic key,
never a target's; nothing outside has to reach localhost, since the agent's
tools run in the cell (`apps/web/.dev.vars.example` says what each needs set).
A deployed Worker without its gateway fails closed: it refuses every agent
send, never fakes one. The model is the agent's definition's, one for
everyone.

### There is no seeded login, and sign-up is invite-only

```sh
pnpm dev:web
# the local D1 file appears on the first request that touches it, so hit one, THEN push
curl -s -o /dev/null localhost:5174/api/auth/get-session
pnpm --filter @repo/web db:push
# mint an invite: add a row to `invite_code` (a fresh `code` each time)
pnpm --filter @repo/web db:studio
```

`/app/sign-up` takes the code, and so does the apps' first run, which is
signing in or creating an account. A code is spent by either door. Auth allows
10 requests/60s per IP; a script creating several users sets
`RATE_LIMIT_DISABLED=true` in `.dev.vars` rather than weakening the limiter.

> **Never run `db:push:remote` or `db:studio:remote`.** Both hit the
> PRODUCTION D1 with the root `.env.production.local` creds. The bare
> `db:push` and `db:studio` are the local ones.

Drive the running site with
[agent-browser](https://github.com/vercel-labs/agent-browser)
(`agent-browser open http://localhost:5174/`). Its skill is committed as a stub
(`.agents/skills/agent-browser`, linked from `.claude/skills/` and pinned by
`skills-lock.json`) that points at `agent-browser skills get core`, the guide
for the installed version.

## Verify a change

```sh
pnpm format:fix && pnpm verify
```

`format:fix` runs FIRST and never after the gates; `verify` (`typecheck`,
`lint`, `knip`, `format`, `test`, `build`, one turbo run that reports every
red task) is check-only for that reason. CI runs `pnpm verify` plus the steps
it cannot (`docs/development.md` § Quality gates), so run `pnpm e2e` too before
claiming a green CI; it runs its scenarios in lanes, one per two cores and at
most four (`--lanes 1` runs them one at a time).

Inside a work stream (§ Rules that matter), run what the change reaches: the
gates of the workspaces it touched since the stream's base and of their
dependents, and the stream's own scenarios. `verify:affected` is `verify`'s
run over those workspaces, under the same concurrency cap and reporting every
red task, `build` included; `format:fix` has already done `format`'s part.

```sh
pnpm format:fix
TURBO_SCM_BASE=<the stream's base> pnpm verify:affected
pnpm e2e --only <the stream's scenarios>
```

The full `pnpm verify` and a full `pnpm e2e` run once per PR, on its last
commit, before it is called green, and so does this check of the declines
register (§ Decisions), which no guard can read: every file a line ends by
naming is still in the tree, and a line whose file the PR removed is deleted
or repointed in the same PR.

```sh
gh api repos/kyh/inteligir/issues/912 --jq .body | grep -oE '\(`[^`]+`\)$' | tr -d '()`' |
  sort -u | while read -r p; do git ls-files --error-unmatch -- "$p" >/dev/null 2>&1 || echo "gone: $p"; done
```

Releasing is the owner's: a change whose proof needs a device, an account or a
credential adds its check to `docs/releasing.md` § 5, under its surface.

### Platform matrix

Every surface, and how an agent sees it run; a scenario is one of
`tools/e2e/src/scenarios`, run as `pnpm e2e --only <name>`.

| Surface                 | Dev command          | Agent-verifiable at runtime?                                                                              |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| The site and the Worker | `pnpm dev:web`       | **Yes**: agent-browser or curl on `localhost:5174`; `built-worker-boot`, `account-hosted`                 |
| The library in a tab    | `pnpm dev:web`       | **Yes**: agent-browser on `localhost:5174/library`; `browser-smoke`, `library-browser`                    |
| The connector           | `pnpm dev:web`       | **Yes**: an MCP client on `localhost:5174/connector`, signed in by OAuth with PKCE; `connector-tools`     |
| The built-in agent      | `pnpm dev:web`       | **Over a scripted Claude**: a turn's events and its writes, `agent-cell`; a real turn is the owner's      |
| The Mac app             | `pnpm dev`           | **On Linux**: `desktop-shell`, `desktop-onboarding` (under `xvfb-run -a`); on a Mac, `pnpm smoke:desktop` |
| The browser extension   | `pnpm dev:extension` | **In Chromium**: `browser-extension` loads the dev build beside a running Worker                          |
| The phone               | `pnpm dev:mobile`    | **Its parts**: `phone-editor-page` (its editor page), `phone-offline-edit` (its runtime under node)       |

What no agent can run is the owner's, in `docs/releasing.md` § 5: the signed
.app opened from Finder, the store extension in Chrome, Arc, Brave and Edge,
the phone app itself, which needs the simulator or the device, a real turn on
a preview through its gateway, and the connector signed in from
claude.ai, Claude Code and ChatGPT. `pnpm dev:mobile` also needs a terminal:
turbo hands `expo start` the keyboard (`apps/mobile/turbo.json`) and refuses
to start it without one, or under `CI`, where `pnpm --filter @repo/mobile dev`
runs it bare.

## Rules that matter

- **No users yet** (§ Project Overview): no migration, no old-shape reader, no
  legacy-name warning.
- **`pnpm format:fix` before the gates, commit after.**
- **A change a user can notice updates `CHANGELOG.md` in the same task**, under
  `## Unreleased`, in the words of someone who takes notes, saying what to do
  about a behaviour that changed or went away; a release's notes are that
  section.
- **Product surfaces speak the user's words.** The window, the browser tab, the
  phone, the browser extension, onboarding, the consent page, the site and the
  changelog (outside an earlier release's `### On the command line` heading)
  never say git, commit, remote, repo, terminal, CLI, PATH or MCP, and call the
  whole of it the library and what is in it items; "note" stays the name of
  what the person writes, and an MCP server is a connector. The built-in
  agent's instructions and code keep their words
  (`tools/repo-guards/src/product-words.test.ts`).
- **No `any`, no non-null `!`, no type assertions** (lint-enforced, no escape
  comment; `as const` and `satisfies` are fine): parse at the boundary or
  narrow with a guard. Kebab-case filenames. Make illegal states
  unrepresentable.
- **`@repo/notes` is pure and platform-neutral**: no node, react or ui imports
  and no `crypto` global (lint-enforced); callers inject the SQL driver, the
  clock, random bytes and fresh ids.
- **knip is a CI gate**, `verify`'s `//#knip` task, which
  `pnpm turbo run //#knip` runs alone after the extension's `generate`
  (`docs/development.md` § Quality gates): a new file must be reachable from
  an entry, and every export must have an importer, an entry's included. It
  runs twice, the second time `--production`, where an export only a suite
  imports is tagged `@internal`. Knip's plugins find tests, routes and
  scripts, and `knip.json` names only what they cannot see,
  `ignoreDependencies` included.
- **The record is the decision files and GitHub Issues.** No `plans/`, ADR docs
  or `*_GAPS.md`.
- **A large change goes as stacked PRs, one per work stream**, each based on
  the one before it and reviewable alone. A repo-wide convention move, or a
  tooling change the stream does not need, is its own PR off `main`, so
  neither hides in the other's diff.

## Across workspaces

One line per rule that binds more than one workspace; the bullet behind each
is in the file named.

- **The cell owns every rule; a device holds a replica.** Every write is
  guarded, applied and logged by the account's library cell; a device reads
  its replica and writes through its outbox, and the page asks the Mac's
  shell only what a browser cannot do (the replica, the credential, the file
  cache, the updater), one row of `apps/workspace/src/shell/ipc-contract.ts`
  each (`apps/desktop/CLAUDE.md`).
- **`/v1` breaks only behind the client build floor**: a client ignores what it
  does not know and the Worker refuses an older build (`apps/web/CLAUDE.md`).
- **The phone holds a full replica, and asks the built-in agent online**: it
  reads and queues offline as the Mac does, and its threads are the account's,
  the same on every device (`apps/mobile/CLAUDE.md`).
- **One write policy**: every write carries the base it was computed from (a
  block's hash, a field's value), the cell applies a block only while its base
  holds and answers `CONFLICT` with the block as it is, and the editor's diff3
  settles that in every host (`apps/web/CLAUDE.md`, `packages/editor/CLAUDE.md`).
- **The UI is `@repo/ui`'s**: every floating surface a Base UI primitive through
  it, chrome text in the five type roles (`packages/ui/CLAUDE.md`), and the
  React Compiler on for every bundle (`tools/repo-guards/CLAUDE.md`).
- **A value has one spelling**: a key binding comes from the table its listener
  reads (`packages/editor/CLAUDE.md`), a page preference is a `PREFS` row
  (`apps/workspace/CLAUDE.md`).
- **The extension is a `/v1` client with its own device credential**: it ships
  on the Web Store's cadence, so the build floor holds it as it holds every
  client (`apps/extension/CLAUDE.md`).
- **A library scope has one spelling**: `@repo/domain/library-scope`, read by
  the page's pref, the items listing and the view context
  (`apps/workspace/CLAUDE.md`).

## Decisions

A decision bullet is the rule, what it rejected and why, and the file that
carries the mechanism; the code and its tests state the mechanism itself. A
bullet says what is, never how it came to be, and states a format, never the
way from an older one. Append a new bullet to the end of its group, in the
file nearest the code it governs; every path in these files is held to the
tree by `tools/repo-guards/src/dangling-references.test.ts`, and this index to
the files by `tools/repo-guards/src/decisions-index.test.ts`.

- [`packages/editor/CLAUDE.md`](packages/editor/CLAUDE.md) — Editor and dialect, an item edited by its id, and the open item's merge
- [`packages/ui/CLAUDE.md`](packages/ui/CLAUDE.md) — floating surfaces, pickers, type roles, popup motion, row order, the orphan guard
- [`packages/notes/CLAUDE.md`](packages/notes/CLAUDE.md) — the Library model (nodes, ops, order, undo, SQL, listing); Items and Knowledge: search, links and tags
- [`packages/page-reader/CLAUDE.md`](packages/page-reader/CLAUDE.md) — reading a saved page into an item: the one reader, over its host's DOM
- [`packages/library-replica/CLAUDE.md`](packages/library-replica/CLAUDE.md) — the replica engine: its ports, the pull, the overlay, the outbox, the socket and the in-memory SQLite
- [`packages/agent-panel/CLAUDE.md`](packages/agent-panel/CLAUDE.md) — the built-in agent's panel, one package every device draws
- [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) — Cloud, sync and accounts
- [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md) — the phone: its editor page, its replica and files, the agent, its look, and how it ships
- [`apps/desktop/CLAUDE.md`](apps/desktop/CLAUDE.md) — the Mac app: its window and bridge, its replica, credential and files, updates, dictation, and the shell's e2e
- [`apps/extension/CLAUDE.md`](apps/extension/CLAUDE.md) — the browser extension: its connection, its saves and its queue
- [`apps/workspace/CLAUDE.md`](apps/workspace/CLAUDE.md) — the library's page: the page over the cell, and its surfaces
- [`tools/repo-guards/CLAUDE.md`](tools/repo-guards/CLAUDE.md) — Repo guards, vendoring and tooling

A citation of `CLAUDE.md § X` names the bullet or group titled X in whichever
of these files holds it: `git grep -F 'X' -- '*CLAUDE.md'` finds it.

**Before raising a "new" finding**, read the decision record and the declines
register, [#912](https://github.com/kyh/inteligir/issues/912): one line per
proposal already refused, with its reason and the file that carries it. A
finding that matches a line is not new, and a new decline is a line added
there, not an issue. A decline that weighs a migration's cost or an older
install yields to the no-users premise.
