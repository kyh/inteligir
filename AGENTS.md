# AGENTS.md

**inteligir** is a library of everything you save, with an agent that files
and edits it with you: links, articles, images, PDFs and your own notes, one
app in place of a bookmark manager like Raindrop and a notes app like
Obsidian. It is a Mac and iPhone app for general knowledge workers, not
developers, on Apple silicon, that nobody uses yet. Each account's library is
one SQLite Durable Object, its library cell, on the one Cloudflare Worker we
ship, which also carries the site, accounts, the library's bytes and the
reading of saved pages; every device holds a replica of that library, reads
it offline and queues what it writes. The built-in agent runs on Claude
Managed Agents and reaches the library only through the connector, the same
door the user's own Claude or ChatGPT uses. Everything we host is Cloudflare.

This is the root guide for every coding agent; `CLAUDE.md` imports it. Each
workspace's durable decisions live in a `CLAUDE.md` beside its code
(§ Decisions), `CONTEXT.md` is the domain glossary, `docs/development.md` owns
the commands, the ports and where state lives, and `docs/releasing.md` is the
owner's release runbook.

## Project Overview

The premises every change builds from, each with its reason:

- **Each account's library is one SQLite Durable Object, its only writer, and
  the source every replica pulls from**, because one writer per account needs
  no merge between servers, one change log with one counter is all a device
  follows to catch up, and the cell and both device replicas run the same
  SQLite and the same full-text search.
- **An account is required, and its first 1 GB is free.** The library lives in
  the cloud and every device holds a replica, because the cell is the one
  place the Mac, the phone, the browser tab, the extension and every agent
  meet; R2 holds the bytes, D1 the accounts.
- **Every item is one record: fields plus a body of Plate blocks.** A link is
  an item whose fields hold its url, site and saved date and whose article
  section holds the page's readable text; an image or PDF is an item whose
  fields name its original file, kept in R2 by its hash; a note the user
  writes is an item too.
  Markdown is how a library comes in, how it goes out, and how an agent reads
  and edits it. One shape is what lets search, History, sync, every device and
  the agent's tools work on every item without a second store, and a row per
  block is what lets two devices' edits to different blocks merge with no
  round trip.
- **The apps and every agent call the same oRPC procedures, and a tool is a
  procedure tagged with `mcp.tool`.** The cell implements the library's
  contract once and serves it at two doors, `/v1` for the apps and the
  connector for agents, because an agent should do what the app does, guarded
  the same way, and nothing the app cannot.
- **The Mac and the phone read everything offline and queue writes; the
  agent, import, export, History and the account need a connection**, because
  every row and body is on the device while those run in the cell, and an
  action that needs a connection says so rather than failing late.
- **The phone is a full editor over its replica, queues writes offline, and
  asks the built-in agent when online**, because the phone is where much is
  saved and read, and the agent and its threads are the account's, the same on
  every device.
- **Saving calls no model. The device that saves reads the page when it can,
  and the cloud reads it otherwise.** The extension and the phone's share sheet
  read the page they are on; a paste, an import or an agent's save lands at
  once as an unread item that the Worker's fill reads; the agent files, tags
  and summarizes only when asked, because a save should be instant and free.
- **The built-in agent runs on Claude Managed Agents, on our bill, and the
  user's own Claude or ChatGPT reaches the same library through the
  connector**, because a knowledge worker has no agent to install and no plan
  to bring, and an assistant they already pay for should find the library
  where it already looks. An assistant signs in to us with OAuth on our consent
  page, so the app holds no model credential of the user's and never asks for
  a key.
- **Model calls happen only inside Managed Agents sessions the cell starts,
  each capped by a session budget and checked against the account's allowance
  before every turn**, because every model call is one we pay for, and one no
  budget holds is an unbounded bill. A save, a sync and a connected assistant's
  call make none.
- **History and undo are revisions and change sets, and no product surface
  says git, commit, remote, repo, terminal, CLI, PATH or MCP**, because none of
  those words is the user's; the connector is what Claude itself calls an MCP
  server.
- **Dictation is the operating system's**, because the Mac's and the phone
  keyboard's are already there and cost the app no speech model.
- **Every feature is core, and a feature serves saving, reading or writing or
  goes.** Nothing sits behind a tier or a flag; a feature that serves none of
  the three is removed, never hidden, and the persona changes the words. The
  built-in agent has one model for everyone, and a plan differs only in its
  allowance.
- **No users yet, so every format may change.** Nobody but the owner holds an
  install, and a shim kept for nobody is code every later change steps
  around. So change any wire, row or database format freely, and write no
  migration, no reader for an older build's shape, no retired-path sweep and
  no legacy-name warning: what an older build wrote is replaced, never read.
  `/v1` may break, behind the client build floor the same change raises. Until
  the premise ends, a decision bullet or a line of the declines register that
  keeps a shape for an older install yields to it. The one exception is the
  phone's database, which appends a step once EAS has built the app, since it
  cannot yet replace a file it cannot read (THE PHONE HOLDS EVERY NOTE'S TEXT
  IN SQLITE, in `apps/mobile/CLAUDE.md`). The first outside tester ends the
  premise: strike this bullet before their first build, and from then on a
  format change migrates.

**Four programs over one Worker.** `apps/web` is the Worker: the site and
accounts, `/v1` (the apps' one wire, `/v1/rpc`, beside the library's bytes
and the socket that tells a device the library moved), the connector, the
queue that reads saved pages, and every account's library cell. The built-in
agent is Anthropic's: one agent and one environment per deployment target,
configured by files in `apps/web` and synced with `ant apply`; the cell starts
and reads its sessions, and the agent reaches the library only through the
connector. `apps/desktop` is the Mac app, installed as the signed dmg: a
Tauri window showing the SPA `apps/workspace` builds, bundled into the .app,
with the Mac's replica, the Keychain credential and the cache of the
library's files in Rust, and no node; the same SPA is the browser tab the
Worker serves at `/library`, online only. `apps/mobile` is the iPhone app:
the same editor over the phone's own replica, offline. `apps/extension` is
the browser's Save, with a device credential of its own, saving to `/v1`. The
replica engine, the outbox and its sync, is one pure package the SPA and the
phone both run. There is no local server and no command line: a coding agent
drives the product the way a person or an assistant does, the tab in
agent-browser, the Worker with curl, the library through the connector.

**The decision record is GitHub issues
[#542](https://github.com/kyh/inteligir/issues/542),
[#611](https://github.com/kyh/inteligir/issues/611) and
[#889](https://github.com/kyh/inteligir/issues/889)**: what was chosen, and
what was rejected and why. Where two disagree the later wins. Where any of
them, or a decision bullet, assumes a local server, a folder of markdown
files, git, an agent on the user's own plan, a developer at the keyboard, or a
notes app whose window is always one open note, this guide wins, and the
change that touches that code rewrites the bullet in the same commit.

## Map

```
apps/web                @repo/web — ONE Cloudflare Worker: site, accounts, /v1, the connector, fills, each account's library cell
apps/workspace          @repo/workspace — the SPA: the Mac app's window, and the browser tab at /library
apps/desktop            @repo/desktop — THE MAC APP: the Tauri window around the SPA; the replica, credential and file cache in Rust
apps/mobile             @repo/mobile — the iPhone app: the library in the editor page, over its own replica, offline
apps/mobile-editor      @repo/mobile-editor — the phone's editor page: @repo/editor as one script behind a WebView bridge
apps/extension          @repo/extension — the Chromium extension: toolbar and right-click Save to /v1, with its own credential
packages/domain         @repo/domain — zod-only leaf vocabulary
packages/contract       @repo/contract — ONE client-safe contract for /v1: the library and the account
packages/notes          @repo/notes — the pure, platform-neutral domain: the library model, its SQL, search and links
packages/editor         @repo/editor — the Plate WYSIWYG, and the markdown codec over its headless kits
packages/page-reader    @repo/page-reader — a saved page read into an item, over the DOM its host hands it
packages/agent-skills   @repo/agent-skills — the dialect spec the built-in agent's instructions are built from
packages/ui             @repo/ui — the shared component vocabulary on Base UI
tools/repo-guards       @repo/repo-guards — fitness tests over the repo itself
tools/e2e               @repo/e2e — the scenario suite `pnpm e2e` runs
tools/ui-gallery        @repo/ui-gallery — the @repo/ui gallery `pnpm dev:gallery` serves, never deployed
```

The replica engine is the `library-replica` package, pure as `@repo/notes`
is. Turborepo + pnpm, oxlint/oxfmt, vitest, knip. The site is TanStack Start,
React 19 and Tailwind 4 on the Worker; auth is Better Auth on D1 (email and
password, invite-gated, no social providers); the library cell is a SQLite
Durable Object, the bytes are in R2, saved pages are read off a Queue, OAuth
is `@cloudflare/workers-oauth-provider` on KV, and the cell drives the
built-in agent with `@anthropic-ai/sdk`. The Mac is Tauri 2; the phone is
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

The local Worker's built-in agent talks to a fake Managed Agents API, chosen
by a dev-only binding in `.dev.vars`: no key, no model, and the mode every e2e
scenario runs. A real agent needs `ANTHROPIC_API_KEY` there instead, and a
public tunnel to the connector, since Anthropic's MCP proxy cannot reach
localhost. A deployed Worker without the key fails closed: it refuses every
agent send, never fakes one. The model is the agent file's, one for everyone.

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
| The connector           | `pnpm dev:web`       | **Yes**: an MCP client on `localhost:5174/connector`, signed in by OAuth with PKCE                        |
| The built-in agent      | `pnpm dev:web`       | **Over the fake Managed Agents API**: a turn's events and its writes; a real session is the owner's       |
| The Mac app             | `pnpm dev`           | **On Linux**: `desktop-shell`, `desktop-onboarding` (under `xvfb-run -a`); on a Mac, `pnpm smoke:desktop` |
| The browser extension   | `pnpm dev:extension` | **In Chromium**: `browser-extension` loads the dev build beside a running Worker                          |
| The phone               | `pnpm dev:mobile`    | **Its parts**: `phone-editor-page` (its editor page), `phone-offline-edit` (its runtime under node)       |

What no agent can run is the owner's, in `docs/releasing.md` § 5: the signed
.app opened from Finder, the store extension in Chrome, Arc, Brave and Edge,
the phone app itself, which needs the simulator or the device, a real Managed
Agents session against a preview's connector, and the connector signed in from
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
  section. A command-line change goes under `### On the command line`.
- **Product surfaces speak the user's words.** The window, the browser tab, the
  phone, the browser extension, onboarding, the consent page, the starter
  library, the site and the changelog (outside its `### On the command line`
  heading) never say git, commit, remote, repo, terminal, CLI, PATH or MCP, and
  call the whole of it the library and what is in it items; "note" stays the
  name of what the person writes, and an MCP server is a connector. The
  built-in agent's instructions and code keep their words
  (`tools/repo-guards/src/product-words.test.ts`).
- **No `any`, no non-null `!`, no type assertions** (lint-enforced, no escape
  comment; `as const` and `satisfies` are fine): parse at the boundary or
  narrow with a guard. Kebab-case filenames. Make illegal states
  unrepresentable.
- **`@repo/notes` is pure and platform-neutral**: no node, react or ui imports
  and no `crypto` global (lint-enforced); callers inject the SQL driver, the
  clock, random bytes and fresh ids.
- **`pnpm knip` is a CI gate**: a new file must be reachable from an entry.
  Knip's plugins find tests, routes and scripts, and `knip.json` names only
  what they cannot see, `ignoreDependencies` included.
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
  cache, the updater, Reveal/Open, printing, the diagnostics), one row of
  `apps/workspace/src/shell/ipc-contract.ts` each (`apps/desktop/CLAUDE.md`).
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

- [`packages/editor/CLAUDE.md`](packages/editor/CLAUDE.md) — Editor and dialect, and the open note's saves and renames
- [`packages/ui/CLAUDE.md`](packages/ui/CLAUDE.md) — floating surfaces, type roles, popup motion, row order, the orphan guard
- [`packages/notes/CLAUDE.md`](packages/notes/CLAUDE.md) — the Library model (nodes, ops, order, undo, SQL, listing); Items, annotations, and Knowledge: the scan, search, links and tags
- [`packages/page-reader/CLAUDE.md`](packages/page-reader/CLAUDE.md) — reading a saved page into an item: the one reader, over its host's DOM
- [`packages/agent-runtime/CLAUDE.md`](packages/agent-runtime/CLAUDE.md) — the local agent runtime the built-in agent replaces: the provider grammar, and what a session may load from the vault
- [`apps/cli/CLAUDE.md`](apps/cli/CLAUDE.md) — the local server the library cell replaces: its lock, composition, credential, shutdown, CSP, database, and a vault's data dir
- [`apps/cli/src/server/vault/CLAUDE.md`](apps/cli/src/server/vault/CLAUDE.md) — the local vault the library cell replaces: writes, git and containment
- [`apps/cli/src/server/knowledge/CLAUDE.md`](apps/cli/src/server/knowledge/CLAUDE.md) — the local index the replicas' SQL replaces: its persistence, its worker and its read deadline
- [`apps/cli/src/server/items/CLAUDE.md`](apps/cli/src/server/items/CLAUDE.md) — Items: capture and fill, which the Worker takes over
- [`apps/cli/src/server/agents/CLAUDE.md`](apps/cli/src/server/agents/CLAUDE.md) — the local agents and threads the built-in agent replaces
- [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) — Cloud, sync and accounts
- [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md) — the phone: its editor page, store, queue and annotations, its look, and how it ships
- [`apps/desktop/CLAUDE.md`](apps/desktop/CLAUDE.md) — the desktop shell, dictation, and the shell's e2e
- [`apps/extension/CLAUDE.md`](apps/extension/CLAUDE.md) — the browser extension and its wire
- [`apps/workspace/CLAUDE.md`](apps/workspace/CLAUDE.md) — Desktop workspace surfaces
- [`tools/repo-guards/CLAUDE.md`](tools/repo-guards/CLAUDE.md) — Repo guards, vendoring and tooling

A citation of `CLAUDE.md § X` names the bullet or group titled X in whichever
of these files holds it: `git grep -F 'X' -- '*CLAUDE.md'` finds it.

**Before raising a "new" finding**, read the decision record and the declines
register, [#912](https://github.com/kyh/inteligir/issues/912): one line per
proposal already refused, with its reason and the file that carries it. A
finding that matches a line is not new, and a new decline is a line added
there, not an issue. A decline that weighs a migration's cost or an older
install yields to the no-users premise.
