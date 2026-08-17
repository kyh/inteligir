# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent). The repo is
mid-rewrite: **v3 architecture is GitHub issue
[#542](https://github.com/kyh/inteligir/issues/542)**, and features land with
their own issues from that index. What runs today is the marketing site and the
account surface, plus the carried domain packages.

Turborepo + pnpm monorepo.

## Workspace Structure

```
apps/
  app/           @repo/app — THE PRODUCT (issue #545): one local Node process.
                 TanStack Start SPA (UI) served by a custom entry (src/node/,
                 its own tsconfig program) that owns /api/v1 (the contract
                 table on Hono), the /ws invalidation bus, and the db. Dev
                 mounts Vite middlewareMode in-process; prod serves
                 dist/client + the Start server entry's fetch.
  cli/           @repo/cli — the `inteligir` CLI (issue #553): commander over
                 the typed hc client. Every leaf takes --json and is EXECUTED
                 by the fitness test against 400/500; `requireOk` is the one
                 status gate, returning hono's success member so a refusal
                 cannot be printed as an answer. Discovery reuses
                 @repo/app/node/config, then requires the responder's
                 /system/status dataDir to match this checkout's (a
                 neighbouring dev server is refused, never adopted). The app
                 serves the agent manual on GET /api/v1/guide, and the codex
                 runtime injects INTELIGIR_SERVER_URL + a PATH carrying the
                 CLI's bin dir into agent shells, so a model drives the
                 product by typing `inteligir …` in bash.
  launcher/      inteligir — THE PUBLISHED ARTIFACT (issue #555). `npx
                 inteligir` boots the product IN THIS PROCESS: parse the
                 command line, hand it to the app's own boot as environment,
                 import it. Its build stages the app and CLI into
                 `dist/apps/{app,cli}` — the shape both of the app's runtime
                 resolvers already walk, so a packaged install keeps its
                 migrations, its SPA and the agent's CLI-on-PATH with no third
                 code path. better-sqlite3 and @parcel/watcher stay runtime
                 deps (native); everything else is inlined.
  desktop/       @repo/desktop — the Electron shell (issue #555): one window on
                 the local server, supervising it as a CHILD process. The whole
                 security surface is the ORIGIN PIN (src/main/origin-pin.ts,
                 pure + unit-tested): one origin, top-level navigation away
                 goes to the system browser, window.open denied
                 unconditionally, no preload and no IPC. A server already
                 listening is ADOPTED, not fought, and only a child the shell
                 started is killed on quit.
  web/           @repo/web — ONE Cloudflare Worker: the TanStack Start
                 marketing site, the auth pages, Better Auth on D1
                 (invite-gated sign-up), and the v3 cloud (issue #554):
                 device pairing, the per-user ThreadSyncDO (merged thread log
                 + capture inbox + ws invalidation), the flag-gated Artifacts
                 mint. src/worker/ is its own tsconfig program (no DOM —
                 workerd's globals must win).
packages/
  cloud-contract/ @repo/cloud-contract — the cloud wire contract (zod only):
                 pairing, device auth, sync push/pull, captures, the ws ping
                 frames, the typed error envelope. SERVER-SIDE ONLY today:
                 apps/web implements every row, and NOTHING consumes the other
                 half yet — apps/app gets its sync client in a later round of
                 #554, which is what the contract was shaped for.
  typed-routes/  @repo/typed-routes — contract-first Hono route machinery,
                 vendored from bb (MIT): defineRoute rows, compile-time
                 handler enforcement, the hc client schema derivation.
  server-contract/ @repo/server-contract — the wire contract: THE route
                 table + payload schemas, the typed hc client, and the ws
                 notification protocol (subscription targets, per-entity
                 change kinds, strict outbound / lenient inbound).
  db/            @repo/db — drizzle + better-sqlite3 (WAL, sync=NORMAL),
                 committed SQL migrations applied on boot, the DbNotifier
                 seam, prefixed-nanoid ids.
  notes/         @repo/notes — PURE platform-neutral domain: the knowledge
                 engine (link graph, FTS5 search over an injected SqlDriver,
                 tags, tasks, rename byte-surgery) and the markdown pipeline
                 (remark parse, opaque nodes, wiki-links, frontmatter).
                 No node/react/ui imports — lint-enforced.
  ui/            @repo/ui — vendored stock shadcn on Base UI; leaf.
tools/
  repo-guards/   @repo/repo-guards — derived fitness tests over the REPO: the
                 package dependency DAG + its platform-purity rules, ws
                 change-kind reachability, vendored-code provenance. The
                 invariants that span workspaces and belong to none of them.
```

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces, oxlint/oxfmt, vitest, knip
- **Web**: TanStack Start + React 19 + Tailwind CSS 4 on a Cloudflare Worker
- **Auth**: Better Auth on D1 via Drizzle — email+password, bearer tokens,
  optional GitHub/Google, invite-gated sign-up

## Common Commands

```bash
pnpm dev              # THE PRODUCT (apps/app) — the local server, per-checkout port
pnpm dev:desktop      # The Electron shell over it (CDP on 9222)
pnpm dev:site         # apps/web: vite + miniflare on :5174 (pinned, strictPort)
pnpm package:app      # The npm artifact (apps/launcher) — `npx inteligir`
pnpm package:desktop  # An UNSIGNED macOS arm64 dmg
pnpm smoke:package    # Pack, install into a scratch prefix, boot, probe, stop
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify           # The whole gate, mirroring CI
```

`apps/web/README.md` is the product Worker's own guide — routes, auth, the
local loop and the owner-only deploy. `AGENTS.md` is the runnable quickstart;
`CONTEXT.md` glosses the carried domain vocabulary.

## Quality Gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`verify` is `typecheck && lint && knip && format && test && build` — the same
six steps CI runs, in one command so no caller can drift from CI. It is
check-only on purpose: `format:fix` runs FIRST.

**There is no seeded login, and sign-up is invite-only.** `AGENTS.md` has the
recipe. Never run `db:push` or `db:studio`: both hit production D1; the local
command is `db:push:local`.

## Decisions

- **Better Auth's `baseURL` is derived per-request from the request origin**,
  never configured or allowlisted. Every hostname that reaches this Worker is
  one the deployment owns, and Cloudflare routes by hostname, so a spoofed
  `Host` never arrives. A fixed fallback would mint password-reset links back
  at the wrong deployment; deriving makes localhost/preview/prod work with no
  config. The trigger to revisit is a hostname the deployment does not fully
  control reaching the Worker.
- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`apps/web/src/worker/auth/invite.ts`), claiming the code in one atomic
  statement and then forwarding into the one instance built with
  `disableSignUp` off. Every other caller's instance carries the flag, which
  shuts `/api/auth/sign-up/email` and `auth.api.signUpEmail` together; each
  social provider carries its OWN `disableSignUp`, so a provider is a sign-in
  for an account that already linked it, never a way to get one.
- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer, an additive schema, and nothing derived that can rot —
  `apps/web/vitest.config.ts` builds the test DDL by running `drizzle-kit
export` over `src/worker/db/schema.ts`. A second deployer or a destructive
  column change is the trigger for adopting migrations. **Never flip the
  timestamp mode in place**: both modes read the same INTEGER column, so a
  redeploy without an accompanying `UPDATE <table> SET <col> = <col> * 1000`
  reads every stored date back as 1970 — which expires every live session.
- **`KnowledgeIndex` in @repo/notes is not dead code — do not delete it.**
  `@repo/notes` carries no sqlite dependency deliberately (`SqlDriver` is
  platform-injected), so this in-memory composition is the ONLY way the package
  can test its own knowledge engine; the related-notes, tags, link-graph and
  perf-oracle suites drive production logic through it.
- **The editor never refuses a file it can PARSE** — unknown constructs become
  opaque nodes (`@repo/notes/markdown/remark-opaque`) that serialize back
  byte-for-byte. `remark-mdx-agnostic.ts` composes the mdx extensions with a
  crash-free lookahead so JSX runs only where a tag can start; `htmlFlow` and
  `codeIndented` stay disabled (see the module headers for why).
- **Frontmatter is the ONLY property store.** No metadata table, ever. YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **No coverage tooling, on purpose.** This repo enforces targeted invariants
  structurally rather than via a global percentage: the dependency DAG and its
  platform rules, ws change-kind reachability and vendored provenance
  (`tools/repo-guards`), route-table completeness
  (`apps/app/src/node/__tests__/route-table.test.ts`), migration↔schema
  agreement (`packages/db/src/__tests__/schema-agreement.test.ts`),
  no-orphan-components, component provenance, the CLI guide and its `--json`
  flags, the editor's buffer invariant. A test that fails when a THIRD dispatch
  path appears is worth more than a percentage a suite asserting nothing can
  satisfy. If coverage is ever added: `coverage.include` is MANDATORY in
  Vitest 4, and gate only `@repo/notes`.
- **A structural guard states its own rule in the failure**, names the file, and
  derives every value it compares. No hardcoded counts, no hand-copied lists —
  the one exception is `dep-dag.test.ts`'s `DECLARED_EDGES`, which IS the pin
  rather than a copy of one.
- **`packages/ui/components.json` declares `rsc: true` and it is deliberately
  inert** — the `"use client"` directives it produces are ignored by every
  consumer, all plain Vite builds with no RSC bundler in the graph.

**Before raising a "new" finding, read the `note` issues** —
[#446](https://github.com/kyh/inteligir/issues/446),
[#453](https://github.com/kyh/inteligir/issues/453),
[#472](https://github.com/kyh/inteligir/issues/472),
[#474](https://github.com/kyh/inteligir/issues/474) hold investigated-and-
declined findings. An issue's plan can name paths that no longer exist even
when its concern is live — verify every path before following it.
