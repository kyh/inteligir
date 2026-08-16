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
  web/           @repo/web — ONE Cloudflare Worker: the TanStack Start
                 marketing site, the auth pages, and Better Auth on D1
                 (invite-gated sign-up). src/worker/ is its own tsconfig
                 program (no DOM — workerd's globals must win).
packages/
  notes/         @repo/notes — PURE platform-neutral domain: the knowledge
                 engine (link graph, FTS5 search over an injected SqlDriver,
                 tags, tasks, rename byte-surgery) and the markdown pipeline
                 (remark parse, opaque nodes, wiki-links, frontmatter).
                 No node/react/ui imports — lint-enforced.
  ui/            @repo/ui — vendored stock shadcn on Base UI; leaf.
```

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces, oxlint/oxfmt, vitest, knip
- **Web**: TanStack Start + React 19 + Tailwind CSS 4 on a Cloudflare Worker
- **Auth**: Better Auth on D1 via Drizzle — email+password, bearer tokens,
  optional GitHub/Google, invite-gated sign-up

## Common Commands

```bash
pnpm dev:web          # vite + miniflare on :5174 (pinned, strictPort)
pnpm dev              # Every workspace
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
  structurally (no-orphan-components, provenance, exact schemas) rather than
  via a global percentage. If coverage is ever added: `coverage.include` is
  MANDATORY in Vitest 4, and gate only `@repo/notes`.
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
