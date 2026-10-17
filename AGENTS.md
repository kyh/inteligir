# AGENTS.md

**inteligir** is a library of everything you save, with an agent that files
and edits it with you: links, articles, images, PDFs and your own markdown
notes, one app in place of a bookmark manager like Raindrop and a notes app
like Obsidian. It is a Mac app for general knowledge workers, not developers,
on Apple silicon, that nobody uses yet. The vault is a folder of markdown files
on the user's own disk, and every item in the library is one of them; one
local Node process owns that vault, indexes it, answers one API and drives the
agent that edits those same files. The only hosted piece is a Cloudflare
Worker carrying the marketing site, accounts, cross-device sync, the dispatch
inbox a phone asks a Mac through, and the account's hosted vault.

This is the root guide for every coding agent; `CLAUDE.md` imports it. Each
workspace's durable decisions live in a `CLAUDE.md` beside its code
(§ Decisions), `CONTEXT.md` is the domain glossary, `docs/development.md` owns
the commands, the ports and where state lives, and `docs/releasing.md` is the
owner's release runbook.

## Project Overview

The premises every change builds from, each with its reason:

- **The agent runs on the user's own Claude or ChatGPT plan, on their Mac,**
  through the runtimes bundled inside the .app, because the owner never pays
  for model usage and a knowledge worker has no agent to install.
- **Signing the agent in is the vendor's own sign-in, into the vendor's shared
  store** (`~/.claude`, `~/.codex`), so a Mac already signed in stays signed in
  and the app never holds a model credential of its own.
- **There is no API-key fallback**: a key is a bill the user never chose and a
  secret the app would have to keep.
- **No model call goes through the Worker or the phone**, because a model call
  there is one the owner pays for.
- **Git is the engine, never the vocabulary.** History, undo and sync ride git,
  and no product surface says git, commit, remote, repo, terminal, CLI, PATH or
  MCP, because none of those words is the user's. Settings › Advanced is the one
  exception, for the user who brings their own sync server.
- **The phone is a full editor.** It writes through a guarded Worker endpoint
  and asks a Mac to run the agent, because a phone holds neither git nor a
  model.
- **Connectors are the default agent's own MCP config**, because one registry,
  the vendor's, with the vendor's own sign-in, beats a second one beside it.
- **Dictation is the operating system's**, because the Mac's and the phone
  keyboard's are already there and cost the app no speech model.
- **Every item is one markdown file.** A link is a note whose frontmatter holds
  its url, site and saved date and whose body is the page's readable text; an
  image or PDF is the original file beside a note that embeds it; a note the
  user writes is an item too. One shape is what lets search, History, sync,
  the phone and the agent's verbs work on every item without a second store.
- **Saving calls no model.** The Mac's own server fetches a page's title, cover
  and text, and the agent files, tags and summarizes only when asked, because
  a save should be instant and free.
- **Every feature is core, and a feature serves saving, reading or writing or
  goes.** Nothing sits behind a tier or a flag; a feature that serves none of
  the three is removed, never hidden, and the persona changes the words.
- **An account is optional, and offered.** Without one the app is a local library
  app that makes no cloud request; with one it syncs, and the hosted vault is
  free up to about 1 GB.
- **No users yet, so every format may change.** Nobody but the owner holds an
  install, and a shim kept for nobody is code every later change steps
  around. So change any wire, file or database format freely, and write no
  migration, no reader for an older build's shape, no retired-path sweep and
  no legacy-name warning: what an older build wrote is replaced, never read.
  `/local` and `/cloud` may both break, a `/cloud` break raising the client
  build floor in the same change. Until the premise ends, a decision bullet
  or a note issue's decline that keeps a shape for an older install yields to
  it. The one exception is the phone's database, which appends a step once
  EAS has built the app, since it cannot yet replace a file it cannot read
  (THE PHONE HOLDS EVERY NOTE'S TEXT IN SQLITE, in `apps/mobile/CLAUDE.md`).
  The first outside tester ends the premise: strike this bullet before their
  first build, and from then on a format change migrates.

**Two programs.** `apps/desktop` is the shipped product, installed as the
signed dmg: a Tauri window on the local server, which it runs as its one child
on the node the .app carries, showing the SPA `apps/workspace` builds.
`apps/cli` is the `inteligir` binary: `serve` IS that server, and every other
verb but `vault open` is a client of a running one. The CLI is the agent's
door and the developer's, which is how an agent drives the product from bash;
nothing the user does needs a terminal. `apps/mobile` is the iPhone app: the
same editor over the hosted vault, offline, asking a Mac to run the agent.

**The decision record is GitHub issues
[#542](https://github.com/kyh/inteligir/issues/542),
[#611](https://github.com/kyh/inteligir/issues/611) and
[#889](https://github.com/kyh/inteligir/issues/889)**: what was chosen, and
what was rejected and why. Where two disagree the later wins. Where any of
them, or a decision bullet, assumes a developer at the keyboard, or a notes
app whose window is always one open note, this overview wins, and the change
that touches that code rewrites the bullet in the same commit.

## Map

```
apps/desktop            @repo/desktop — THE SHIPPED PRODUCT: the Tauri window around the SPA
apps/workspace          @repo/workspace — the SPA: the page every vault's server answers, and the first run
apps/cli                inteligir — THE PUBLISHED BINARY: `serve` is the server, every other verb a client
apps/web                @repo/web — ONE Cloudflare Worker: site, auth, device login, thread sync, dispatch, hosted vault
apps/mobile             @repo/mobile — the iPhone app: notes in the editor page, offline, and asking a Mac's agent
apps/mobile-editor      @repo/mobile-editor — the phone's editor page: @repo/editor as one script behind a WebView bridge
packages/domain         @repo/domain — zod-only leaf vocabulary
packages/contract       @repo/contract — ONE contract, TWO entries: /local and /cloud
packages/db             @repo/db — drizzle + better-sqlite3, migrations, notifier
packages/notes          @repo/notes — the pure, platform-neutral domain
packages/editor         @repo/editor — the Plate WYSIWYG over the fixpoint serializer
packages/agent-runtime  @repo/agent-runtime — the ACP runtime over the harnesses
packages/agent-skills   @repo/agent-skills — the dialect spec, as files agents read
packages/ui             @repo/ui — the shared component vocabulary on Base UI
tools/repo-guards       @repo/repo-guards — fitness tests over the repo itself
tools/e2e               @repo/e2e — the scenario suite `pnpm e2e` runs
tools/ui-gallery        @repo/ui-gallery — the @repo/ui gallery `pnpm dev:gallery` serves, never deployed
```

Turborepo + pnpm, oxlint/oxfmt, vitest, knip. The site is TanStack Start,
React 19 and Tailwind 4 on the Worker; auth is Better Auth on D1 (email and
password, invite-gated, no social providers); the phone is Expo, shipped to
TestFlight by EAS. The workspaces' READMEs own their layouts and loops;
`apps/web/README.md` has the Worker's routes and deploy, `docs/privacy.md`
what leaves the machine.

## Quickstart

```sh
pnpm install
pnpm dev             # THE PRODUCT: the shell over its own server
pnpm cli serve       # the server ALONE, from source; a shell started afterwards
                     #   ADOPTS it, so this is the loop for server code
pnpm dev:workspace   # the page alone in a browser tab on that same server: the
                     #   loop for UI work, no Rust
pnpm cli status      # every verb drives this checkout's running instance
pnpm cli guide       # the agent manual the app serves
```

No bootstrap script, no cloud account, no login. Node 24 and pnpm
12 (`corepack enable`; `.codex/environments/environment.toml` runs `pnpm i` for
cloud runners). The port and the data dir are derived per CHECKOUT, so
parallel worktrees never collide; `INTELIGIR_PORT` and `INTELIGIR_DATA_DIR`
override. Every CLI leaf takes `--json`, and `INTELIGIR_DATA_DIR` names WHICH
instance: the port and the bearer are read from its `server.json`, and there is
deliberately no way to point the CLI at a bare URL.

The agent runtime is `INTELIGIR_AGENT` (`acp`, the default, which runs the
vendor binaries bundled beside its adapters; `scripted`; `off`). Which harness
runs is a thread's own `providerId`, claude when unset. **`scripted` is the
login-free e2e mode**: a deterministic driver over the real ingest, timeline,
vault and commit paths. `INTELIGIR_CLAUDE_MODEL` and `INTELIGIR_CODEX_MODEL`
each pass a model to their own harness.

The Worker is separate:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET to anything
pnpm dev:web        # the real Worker on miniflare, http://localhost:5174 (pinned)
```

### There is no seeded login, and sign-up is invite-only

```sh
pnpm dev:web
# the local D1 file appears on the first request that touches it, so hit one, THEN push
curl -s -o /dev/null localhost:5174/api/auth/get-session
pnpm --filter @repo/web db:push
# mint an invite: add a row to `invite_code` (a fresh `code` each time)
pnpm --filter @repo/web db:studio
```

`/app/sign-up` takes the code. The app takes it too: start it with
`INTELIGIR_CLOUD_URL=http://localhost:5174`, open Settings › Account, choose
Create an account. A code is spent by either door. Auth allows 10 requests/60s
per IP; a script creating several users sets `RATE_LIMIT_DISABLED=true` in
`.dev.vars` rather than weakening the limiter.

> **Never run `db:push:remote` or `db:studio:remote`.** Both hit the
> PRODUCTION D1 with the root `.env.production.local` creds. The bare
> `db:push` and `db:studio` are the local ones.

Drive the running site with
[agent-browser](https://github.com/vercel-labs/agent-browser)
(`agent-browser open http://localhost:5174/`).

## Verify a change

```sh
pnpm format:fix && pnpm verify
```

`format:fix` runs FIRST and never after the gates; `verify` (`typecheck`,
`lint`, `knip`, `format`, `test`, `build`, one turbo run that reports every
red task) is check-only for that reason. CI runs `pnpm verify` plus the steps
it cannot (`docs/development.md` § Quality gates), so run `pnpm e2e` too before
claiming a green CI. Releasing is the owner's: a change whose proof needs a device, an
account or a credential adds its check to `docs/releasing.md` § 5, under its
surface.

## Rules that matter

- **No users yet** (§ Project Overview): no migration, no old-shape reader, no
  legacy-name warning.
- **`pnpm format:fix` before the gates, commit after.**
- **A change a user can notice updates `CHANGELOG.md` in the same task**, under
  `## Unreleased`, in the words of someone who takes notes, saying what to do
  about a behaviour that changed or went away; a release's notes are that
  section. A command-line change goes under `### On the command line`.
- **Product surfaces speak the user's words.** The window, the phone,
  onboarding, the seed notes, the site and the changelog (outside its
  `### On the command line` heading) never say git, commit, remote, repo,
  terminal, CLI, PATH or MCP. Settings › Advanced, the CLI, the agent manual
  and code keep their words.
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

## Across workspaces

One line per rule that binds more than one workspace; the bullet behind each
is in the file named.

- **The server owns every rule; the shell orders moves.** The Rust shell asks
  the CLI's desktop door for every rule the server owns, and the page asks the
  shell only what no server can answer (the updater, the vault switch,
  Reveal/Open, printing, the diagnostics), one row of
  `apps/workspace/src/shell/ipc-contract.ts` each (`apps/desktop/CLAUDE.md`).
- **`/local` breaks freely, `/cloud` only behind the client build floor**: a
  `/cloud` client ignores what it does not know and the Worker refuses an older
  build (`apps/web/CLAUDE.md`).
- **The phone runs no agent and speaks no git**: it asks a Mac through the
  claimable dispatch inbox, and the thread is the ledger (`apps/web/CLAUDE.md`).
- **One write policy**: every vault write carries the base it was computed
  from and names its guard, and the editor's diff3-on-409 runs in every host
  (`apps/cli/src/server/vault/CLAUDE.md`, `packages/editor/CLAUDE.md`).
- **Only Settings › Advanced shows the engine's raw state** (`lastError`, the
  remote) (`apps/workspace/CLAUDE.md`).
- **The UI is `@repo/ui`'s**: every floating surface a Base UI primitive through
  it, chrome text in the five type roles (`packages/ui/CLAUDE.md`), and the
  React Compiler on for every bundle (`tools/repo-guards/CLAUDE.md`).
- **A value has one spelling**: a key binding comes from the table its listener
  reads (`packages/editor/CLAUDE.md`), a page preference is a `PREFS` row
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
- [`packages/notes/CLAUDE.md`](packages/notes/CLAUDE.md) — Annotations, and Knowledge: the scan, search, links and tags
- [`packages/agent-runtime/CLAUDE.md`](packages/agent-runtime/CLAUDE.md) — the provider grammar, and what a session may load from the vault
- [`apps/cli/CLAUDE.md`](apps/cli/CLAUDE.md) — the server process: its lock, composition, credential, shutdown, CSP, database, and a vault's data dir
- [`apps/cli/src/server/vault/CLAUDE.md`](apps/cli/src/server/vault/CLAUDE.md) — Vault: writes, git and containment
- [`apps/cli/src/server/knowledge/CLAUDE.md`](apps/cli/src/server/knowledge/CLAUDE.md) — the index's persistence, its worker and its read deadline
- [`apps/cli/src/server/items/CLAUDE.md`](apps/cli/src/server/items/CLAUDE.md) — Items: capture and fill
- [`apps/cli/src/server/agents/CLAUDE.md`](apps/cli/src/server/agents/CLAUDE.md) — Agents and threads
- [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) — Cloud, sync and accounts
- [`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md) — the phone: its editor page, store, queue and annotations, and how it ships
- [`apps/desktop/CLAUDE.md`](apps/desktop/CLAUDE.md) — the desktop shell, dictation, and the shell's e2e
- [`apps/workspace/CLAUDE.md`](apps/workspace/CLAUDE.md) — Desktop workspace surfaces
- [`tools/repo-guards/CLAUDE.md`](tools/repo-guards/CLAUDE.md) — Repo guards, vendoring and tooling

A citation of `CLAUDE.md § X` names the bullet or group titled X in whichever
of these files holds it: `git grep -F 'X' -- '*CLAUDE.md'` finds it.

**Before raising a "new" finding**, read the decision record and the `note`
issues, the declines register (every `note` issue titled "do not re-raise"
among them): #902, #877, #881, #788, #645, #674, #485 (agent-native), #603
(Moss parity) and #705 (the CodeMirror trade); #446, #453, #472 and #474
decline findings against the hosted architecture this one replaced. A decline that
weighs a migration's cost or an older install yields to the no-users premise.
