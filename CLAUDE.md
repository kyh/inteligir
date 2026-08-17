# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent), local-first.
The vault is markdown files in a git repo the user owns; one local Node process
serves the workspace, owns the vault, indexes it, and drives a coding agent
that edits those same files. The only hosted piece is a Cloudflare Worker
carrying the marketing site, accounts, and cross-device thread sync.

**The architecture's decision record is GitHub issue
[#542](https://github.com/kyh/inteligir/issues/542)** — what was chosen, and
what was rejected and why.

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
                 tags, tasks, rename byte-surgery) over ONE markdown scan
                 (scan-parse + wiki-links), plus frontmatter and the
                 delegation marker. No node/react/ui imports — lint-enforced.
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
pnpm verify           # The static gate (CI adds the e2e suite on top)
pnpm e2e              # The scenario suite; --prod for the built shell
```

`apps/web/README.md` is the product Worker's own guide — routes, auth, the
local loop and the owner-only deploy. `AGENTS.md` is the runnable quickstart;
`CONTEXT.md` glosses the carried domain vocabulary.

## Quality Gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`verify` is `typecheck && lint && knip && format && test && build` — the STATIC
gate, in one command so no caller can drift from it. It is check-only on
purpose: `format:fix` runs FIRST.

CI runs those six and then three more that `verify` cannot: it installs
agent-browser and runs the scenario suite in BOTH modes (`pnpm e2e` and
`pnpm e2e --prod`). Both, because they serve different code — dev runs Vite's
middleware and no CSP, prod serves the built shell under the real policy. So a
green `verify` is not a green CI; run `pnpm e2e` too before claiming one.

**There is no seeded login, and sign-up is invite-only.** `AGENTS.md` has the
recipe. Never run `db:push` or `db:studio`: both hit production D1; the local
command is `db:push:local`.

## Decisions

- **THE BUFFER IS THE FILE.** The editor is CodeMirror over the markdown
  source, so byte-stability is a property of the design rather than a
  round-trip to defend: there is no rich-model serializer that can disagree
  with disk. Every construct renders as a decoration over the real text.
- **A write carries the base it was computed from.** `expectedHash` on the
  vault write route is compared under the repo lock; a mismatch answers 409
  WITH the current content, and the client merges (diff3) and retries. Creation
  uses `ifAbsent` instead. Without this, an agent write landing between a
  client's read and its save is silently overwritten — the failure mode is
  invisible, so the guard has to be in the protocol, not the UI.
- **Containment is PHYSICAL, not lexical.** The vault realpaths the deepest
  existing ancestor and refuses symlinked leaves. A lexical check passes
  `notes.md` when that name is a symlink to `~/.ssh/id_ed25519`, and a `git
pull` from a hostile remote is enough to plant one.
- **The vault dir and the data dir must be disjoint**, refused at boot. A data
  dir inside the vault gets committed and pushed — the SQLite database and the
  config with it.
- **Ingest is ONE transaction.** Appending a provider event, projecting the
  thread's lifecycle, and touching the queue happen in one immediate
  transaction; notifications flush after commit. Separately: lifecycle CAS
  predicates include the TURN identity, so a late completion for turn A cannot
  settle turn B.
- **Agent commits stage the turn's own write set**, taken from the fileChange
  events, under a counted commit hold that defers the vault's debounce and
  blocks a sync from starting. Committing the whole dirty tree attributes a
  concurrent turn's writes — and the user's — to whoever settles first.
- **Cloud state names its Durable Object from a VERIFIED credential**, never
  from anything a caller supplies. Account deletion revokes credentials FIRST,
  then purges, then writes a tombstone every route refuses against — the
  reorder alone still leaves an in-flight verified request able to recreate
  state after the purge.
- **Say the delivery guarantee you implement.** Captures are at-least-once
  delivery with exactly-once deletion by the owning claim, so the client's
  apply must be idempotent on the capture id. "Exactly-once" was written first
  and was false in both directions.
- **A delegation marker is parsed, never matched.** `<!-- inteligir:thread
anc_… -->` counts only as a block-level node alone on its line, so the same
  text inside a fence or frontmatter stays literal — and insertion computes a
  legal block boundary, because a marker spliced into frontmatter invalidates
  the YAML and silently changes what `tags:` and `tasks: false` mean. The
  invariant under test: inserting a marker leaves the rest of the document
  parsing identically.
- **The launcher boots in-process; the desktop shell supervises a child.**
  Opposite answers because the failure differs: `npx` wants one exit code and
  a `^C` that reaches the vault's owner, while the shell must not share its
  compositor's event loop with better-sqlite3, a watcher fork and `git`. The
  shell adopts an already-listening server rather than fighting it, and only
  kills the child it started.
- **A LOOPBACK PORT IDENTIFIES NOTHING, so adoption is earned.** Any local
  process can hold 4664 and answer `/health` 200; adopting on that alone hands
  a squatter the trusted window and the origin's storage. Every boot mints a
  secret into `<dataDir>/instance-secret` at 0600 and answers a nonce challenge
  with an HMAC over it (`/api/v1/system/identity`), and a client adopts only
  when the answer verifies against the secret in the data dir IT resolved and
  the responder names that same dir. The bound is honest: it proves the
  responder can READ that data directory, not that it is this code — which is
  exactly the line between "the program that owns this vault" and "the program
  that got to the port first". `/system/status`'s dataDir is a CLAIM; this is
  the proof.
- **Shutdown is ORDERED, per-step TIME-BOXED, and its exit code is the truth.**
  Writers stop, then the vault's pending commit flushes, then the handles
  close. Each step has its own budget because a single budget for the whole
  teardown is not a bound on anything — one wedged step consumes it and starves
  every step behind it, which is precisely how the vault flush gets skipped.
  The listener step must CLOSE THE WEBSOCKETS BY NAME: an upgraded socket is
  detached from the HTTP server's connection tracking, so `server.close()`
  never completes while one is open and `closeAllConnections()` does not touch
  it — one open browser tab stalled the entire teardown at step one, exited 0,
  and left the database un-closed. A step that fails or times out exits
  non-zero and says which.
- **The prod document carries a nonce CSP with `'strict-dynamic'`, not a hash
  list.** The built shell's one inline script hashes cleanly, but the Start
  router INJECTS further inline scripts at runtime whose content varies per
  render, so a hash allowlist blocks the app the moment it hydrates (measured,
  not assumed). `style-src` keeps `'unsafe-inline'` because CodeMirror injects
  its theme at runtime — the one stated residual. The directive that earns the
  most here is `connect-src`: a script that cannot reach a third-party origin
  cannot exfiltrate the vault.
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
  can test its own knowledge engine; the related-notes, tags and link-graph
  suites drive production logic through it.
- **The knowledge scan disables `codeIndented` and `htmlFlow`**
  (`@repo/notes/markdown/scan-parse`). A checkbox is addressed by its POSITION
  among a doc's task items, so the scan's count has to agree with the set the
  editor draws — and CommonMark's defaults are where a micromark scan and
  lezer-markdown diverge. The agreement is pinned from the editor's side by
  `packages/editor/src/__tests__/checkbox-toggle.test.ts`.
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
- **Vendored code carries a RECORD, and the record's own shape says which rule
  it opts into.** A `PROVENANCE.md` names the upstream, a 40-hex commit pin and
  the license, with that license's own text beside it — MIT names a copyright
  holder no per-file notice carries. With no `## Files` manifest it governs its
  WHOLE directory (`packages/agent-runtime`, the prosemark tree); with one it
  governs exactly the files listed, which is what a package that is only partly
  vendored needs (`apps/app`, `apps/cli`, `packages/db`, `packages/domain`,
  `packages/server-contract`, `packages/typed-routes`). Each row names its
  upstream path and whether the code is upstream's or upstream's shape with the
  bodies rewritten, so a re-vendor knows which files will diff. **"Vendored
  from" is the CLAIM** — the phrase `vendor-provenance.test.ts` sweeps for. A
  header saying a file's shape FOLLOWS an upstream's is citing an influence and
  owes nothing; keep the two spellings apart, and do not put the claim over
  code that only borrows an idiom. What no walk can catch is a copy that
  arrives with no notice at all, so whether one is owed is decided when the
  code is copied, not by a green suite.
- **`packages/ui/components.json` declares `rsc: true` and it is deliberately
  inert** — the `"use client"` directives it produces are ignored by every
  consumer, all plain Vite builds with no RSC bundler in the graph.

**Before raising a "new" finding, read
[#542](https://github.com/kyh/inteligir/issues/542)** — the decision record
carries what was rejected as well as what was chosen. The older `note` issues
(#446, #453, #472, #474) catalogue findings declined against the hosted
Durable-Object architecture this rewrite replaced; their concerns rarely
survive the move, and none of their paths do.
