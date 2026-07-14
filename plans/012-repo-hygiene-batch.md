# Plan 012: Repo hygiene batch — fix the stale README gate, CI turbo cache, dev-port cleanup, and config drift

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index (or the index doesn't exist yet — then skip it).
>
> **This plan is a BATCH of six independent fixes.** Each step stands alone.
> Before each step, confirm its "Current state" excerpt matches the live code.
> **If a step's current state does NOT match, SKIP that step**, note it in your
> report, and move to the next one — do not improvise a substitute fix. The
> other steps still stand. A partial landing (five of six) is a success, not a
> failure.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- README.md turbo.json .github/workflows/ci.yml apps/desktop/package.json docs/development.md pnpm-workspace.yaml packages/ui/package.json packages/core/package.json packages/features/package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch in a given step, skip that step (per the batch rule above).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / docs
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

The repo's documented quality gate in `README.md` is _actively wrong_: it omits
`pnpm format:fix` (which must run FIRST) and the `pnpm format` check (which CI
enforces as a hard gate). Anyone following the README ships red. The
format-ordering rule is not cosmetic — a `format:fix` run after green gates once
corrupted the byte-pinned round-trip fixtures and shipped broken (#362,
documented in `docs/development.md:76-87`). Alongside that, five other small
drifts cost real time every week: the README's structure map is missing half the
monorepo (cloud, mobile, core), `turbo.json`'s worker-budget comment cites
numbers that no longer match any vitest config, CI has no turbo cache (every PR
rebuilds and re-typechecks the whole graph cold), killing the stale dev ports
(9222/47888) is a manual `lsof` chore documented in two places with no script to
run, and several deps are pinned independently in multiple manifests instead of
through the pnpm catalog. All six are low-risk, mechanical, and independently
verifiable.

## Current state

Six independent findings, each verified against the live code at `91347c66`.

### 1. `README.md:50-56` — quality-gate block is wrong

````md
## Quality gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build
```
````

````

It omits `pnpm format:fix` (must run FIRST) and the `pnpm format` check
entirely. The canonical gate — `docs/development.md:69-74`:

```md
## Quality gates

```bash
pnpm format:fix   # FIRST — never after gates (see fixture rule below)
pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build
````

````

…and `CLAUDE.md` ("Quality Gates") says the same. CI runs `pnpm format` as a
hard step (`.github/workflows/ci.yml:40-42`), so the README's sequence produces
a locally-green, remotely-red PR.

### 2. `README.md:8-29` — structure map omits three workspaces

```md
## Layout

````

apps/ Shippable artifacts
desktop/ Electron app — main/preload + the product UI (renderer) (@repo/desktop)
web/ TanStack Start marketing site on Cloudflare Workers (landing page only)
packages/ Libraries
features/ Isomorphic contract + node backend (@repo/features)
src/ iso — Bridge/IPC registry, schemas, knowledge engine, markdown
src/server/ node — vault, pi agent, delegation, executor, voice, handlers
ui/ Shared UI components (@repo/ui)

```

```

Missing: `apps/cloud` (the Cloudflare Worker sync backend — Better Auth on D1 +
a `VaultCoordinator` Durable Object + R2), `apps/mobile` (the Expo companion —
sync/read/light-edit, no agent), and `packages/core` (the PURE platform-neutral
domain: `sync/`, `knowledge/`, `markdown/` — the sharing seam between desktop
and mobile). The workspace-README table (`README.md:21-29`) has the same three
holes. Verified: `apps/cloud/README.md` and `apps/mobile/README.md` **exist**;
`packages/core/README.md` does **not** (do not invent one — list core in the
Layout block and either omit its table row or add the row without a link).

The `features/` entry is also slightly stale (it credits `src/` with "knowledge
engine, markdown", which now live in `@repo/core`) — fix that line while you're
there, matching `CLAUDE.md`'s "Workspace Structure" block.

### 3. `turbo.json:28-30` — worker-budget comment cites stale numbers

```jsonc
    // The five suites run in parallel; each vitest config caps maxWorkers
    // (desktop 4, features 3, rest 2) so the combined pool fits the machine —
    // uncapped pools kill workers mid-run ("Worker exited unexpectedly").
    "test": {
      "dependsOn": ["^topo"],
      "cache": false
    },
```

ACTUAL values (verified):

| Config                                  | `maxWorkers` |
| --------------------------------------- | ------------ |
| `apps/desktop/vitest.config.ts:27`      | 3            |
| `packages/features/vitest.config.ts:11` | 2            |
| `packages/core/vitest.config.ts:11`     | 2            |
| `apps/cloud/vitest.config.ts:50`        | 1            |
| `apps/mobile/vitest.config.ts:20`       | 1            |

The authoritative comment already lives at `apps/desktop/vitest.config.ts:22-26`
and is correct:

```ts
    // Worker caps are budgeted across the monorepo: turbo runs all five
    // package suites in parallel, and uncapped pools (10 threads each)
    // exhaust the machine and kill workers mid-run. Budget sums to ~9 on a
    // 10-core machine: desktop 3 (largest suite), features/core 2,
    // mobile/cloud 1.
    maxWorkers: 3,
```

The `turbo.json` comment exists to explain the `"cache": false` + budgeting
decision, so wrong numbers actively mislead the next person who tunes it.

### 4. `.github/workflows/ci.yml` — no turbo cache

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 24
    cache: pnpm
```

`cache: pnpm` caches the **pnpm store only** (dependency downloads). There is no
`actions/cache` step for turbo's local cache and no remote cache configured (no
`TURBO_TOKEN` / `TURBO_TEAM` anywhere in the repo). Meanwhile `turbo.json:8-16`
declares cacheable outputs:

```jsonc
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".cache/tsbuildinfo.json", "dist/**", ".output/**"]
    },
```

…and `typecheck` is cacheable (`outputs: []` — turbo still caches the task's
success + logs). So every PR re-runs typecheck and rebuilds the entire graph
cold. `test` is deliberately `"cache": false` (see finding 3's comment) — **keep
it that way**.

Turbo's local cache directory: `.turbo` at the repo root, plus a per-package
`.turbo` in each workspace — all gitignored (`.gitignore:46-47`:
`# turbo` / `.turbo`). Verified present after a local build: `./.turbo`,
`./apps/{web,desktop,mobile,cloud}/.turbo`, `./packages/{ui,core,features}/.turbo`.

### 5. No dev-port cleanup script

Both docs describe the chore. `docs/development.md:64-67`:

```md
**Only one real host at a time**: `~/.inteligir/host.lock` is a pidfile — a
second host refuses to start. Stale locks from dead pids are reclaimed
automatically. Kill leftovers between runs: anything holding 9222/47888 blocks
the next `pnpm dev:desktop`.
```

`CLAUDE.md` ("Verifying Changes") repeats it: "Kill stale instances between runs
— a leftover Electron/executor process holds ports 9222 and 47888 and the next
launch can't bind them."

Verified: there is **no** kill/cleanup script anywhere. No root `scripts/` dir.
`apps/desktop/scripts/` exists but holds only `verify-runtime-model-registry.mjs`
and `verify-packaged-runtime-deps.mjs`. `apps/desktop/package.json:9-24` scripts:

```json
    "clean": "rm -rf .cache .output",
    "dev": "electron-vite dev --remoteDebuggingPort 9222",
    "dev:harness": "vite --config vite.harness.config.ts",
```

Ports (`docs/development.md:56-62`): 9222 = Electron CDP, 47888 = executor
daemon.

### 6. Catalog drift + a `@types/node` major ahead of the runtime

Same spec, pinned independently in two manifests each (should be `catalog:`):

- `react-day-picker: "^10.0.1"` — `apps/desktop/package.json:68` and `packages/ui/package.json:30`
- `remark-gfm: "^4.0.1"` — `packages/core/package.json:42` and `packages/features/package.json:23`
- `remark-parse: "^11.0.0"` — `packages/core/package.json:44` and `packages/features/package.json:24`

The catalog (`pnpm-workspace.yaml:5-52`) already holds the shared specs for
everything else. Also `pnpm-workspace.yaml:16`:

```yaml
"@types/node": ^26.1.1
```

while the root `package.json:27-29` declares:

```json
  "engines": {
    "node": ">=24"
  }
```

A types major ahead of the runtime can typecheck against APIs the runtime
doesn't have. `@types/node` is consumed via `catalog:` in `apps/web`,
`apps/mobile`, `apps/desktop`, and `packages/features`.

### Conventions that apply

- kebab-case filenames; no `any`, no `!`, no `as` type assertions; no barrel files.
- Conventional commits (see `git log`: `fix(desktop): commit workspace refs`).
- `pnpm format:fix` FIRST, never after gates.
- Flat docs, deliberately: `CLAUDE.md` + `docs/development.md` + PR bodies are
  the record. Do NOT create `docs/adr/`, `CONTEXT.md`, or any new doc file —
  they were deliberately deleted.

## Commands you will need

| Purpose                               | Command                                           | Expected on success |
| ------------------------------------- | ------------------------------------------------- | ------------------- |
| Install                               | `pnpm install`                                    | exit 0              |
| Format (run FIRST, never after gates) | `pnpm format:fix`                                 | exit 0              |
| Typecheck                             | `pnpm typecheck`                                  | exit 0              |
| Lint                                  | `pnpm lint`                                       | exit 0              |
| Dead code                             | `pnpm knip`                                       | exit 0              |
| Format check                          | `pnpm format`                                     | exit 0              |
| Tests                                 | `pnpm test`                                       | all pass            |
| Build                                 | `pnpm build`                                      | exit 0              |
| CI workflow lint (optional)           | `gh workflow view CI` / `actionlint` if available | no errors           |

## Scope

**In scope** (the only files you should modify):

- `README.md` (steps 1, 2)
- `turbo.json` (step 3 — the `test` task **comment only**; do not change task config)
- `.github/workflows/ci.yml` (step 4)
- `apps/desktop/package.json` (step 5 — one script; step 6 — one dep spec)
- `apps/desktop/scripts/kill-dev-ports.mjs` (step 5, only if you choose a script file over an inline shell script)
- `docs/development.md` (step 5 — one line referencing the new script)
- `pnpm-workspace.yaml`, `packages/ui/package.json`, `packages/core/package.json`, `packages/features/package.json` (step 6)
- `pnpm-lock.yaml` (regenerated by `pnpm install` after step 6 — commit it)

**Out of scope** (do NOT touch, even though they look related):

- The `@expo/dom-webview` and `lightningcss` pnpm `overrides`
  (`package.json:31-37`) — deliberately deferred; both need a real mobile/web
  build verification loop that this plan does not run.
- The `@types/react` override (`package.json:34`) — deliberately pinned exact;
  leave it.
- The `pi` packages (`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`) —
  a separate plan (`plans/002-pi-scope-migration.md`) migrates those.
- **Any dependency version bump.** Step 6 RELOCATES specs into the catalog; it
  does not change a single version number (the one exception, `@types/node`, is
  a deliberate downgrade of the _range_, called out explicitly).
- Adding a git-hook / pre-commit tool — that's `plans/013-pre-commit-format-guard.md`.
- `turbo.json`'s `test` task config (`"cache": false` stays), and the `maxWorkers`
  values in the vitest configs (they're correct; the comment is what's wrong).
- Creating `packages/core/README.md` or any new doc file.

## Git workflow

- Branch: `kyh/plan-012-repo-hygiene-batch`
- One conventional commit per step (they're independent — a bisect should land
  on the exact one). Examples:
  `docs(readme): correct the quality-gate sequence`,
  `ci: cache turbo build/typecheck artifacts`,
  `chore(deps): move shared specs into the pnpm catalog`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the README quality-gate block

**Precondition**: `README.md:55` reads
`pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build`. If it
already includes `format:fix`, SKIP this step.

Replace the `## Quality gates` section (`README.md:50-56`) with the canonical
sequence **plus** a pointer to the single source of truth:

````md
## Quality gates

Before committing:

```bash
pnpm format:fix   # FIRST — never after gates
pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build
```
````

`format:fix` runs **first**, never after: a `format:fix` after green gates once
corrupted the byte-pinned round-trip fixtures and shipped red (#362). See
[`docs/development.md`](./docs/development.md#quality-gates) for the rules that
have bitten before.

````

Keep the exact command sequence byte-identical to `docs/development.md:72-73`.

**Verify**:
- `grep -n "format:fix" README.md` → at least one match, in the Quality gates block.
- `grep -n "pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build" README.md docs/development.md` → matches in BOTH files (the sequences agree).
- `grep -cn "pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build" README.md` → `0` (the old, wrong sequence is gone).

### Step 2: Add the three missing workspaces to the README structure map

**Precondition**: `README.md:8-29` Layout block and workspace table list only
desktop, web, features, ui. If `apps/cloud` already appears, SKIP.

In the `## Layout` fenced block, add (matching the existing two-column style and
`CLAUDE.md`'s "Workspace Structure" descriptions):

- `apps/cloud/` — CF Worker (@repo/cloud) — `/api/auth/*` (Better Auth on D1) + `/v1/vault/*` (Durable Object + R2); vault sync, off by default
- `apps/mobile/` — Expo companion (@repo/mobile) — sync + read + light-edit, no agent
- `packages/core/` — PURE platform-neutral domain (@repo/core) — `sync/`, `knowledge/`, `markdown/`; the desktop↔mobile sharing seam

Fix the stale `features/` sub-lines while you're in the block: `src/` is "iso —
Bridge/IPC registry, schemas" (knowledge + markdown moved to `@repo/core`).

In the workspace-README table (`README.md:23-29`), add rows for
`apps/cloud` → `./apps/cloud/README.md` and `apps/mobile` → `./apps/mobile/README.md`
(both verified to exist). For `packages/core` there is **no README** — either
omit its table row entirely or add a row with plain text and no link. Do NOT
create `packages/core/README.md`.

**Verify**:
- `grep -n "apps/cloud\|apps/mobile\|packages/core" README.md` → all three present.
- For every markdown link you added, the target exists:
  `ls apps/cloud/README.md apps/mobile/README.md` → both listed.
- `grep -c "packages/core/README.md" README.md` → `0` (you did not link a file that doesn't exist).

### Step 3: Correct the turbo.json worker-budget comment

**Precondition**: `turbo.json:29` contains `(desktop 4, features 3, rest 2)`.
If not, SKIP.

Replace the comment above the `test` task with the real budget (or drop the
numbers and point at the configs — but the numbers are useful, so prefer
stating them correctly):

```jsonc
    // The five suites run in parallel; each vitest config caps maxWorkers
    // (desktop 3, features/core 2, cloud/mobile 1 — budget sums to ~9 on a
    // 10-core machine; see apps/desktop/vitest.config.ts) so the combined pool
    // fits the machine — uncapped pools kill workers mid-run ("Worker exited
    // unexpectedly"). That's also why `test` is uncached.
````

Do NOT change the task body (`"dependsOn": ["^topo"], "cache": false`).

**Verify**:

- `grep -n "desktop 4" turbo.json` → no matches.
- `grep -rn "maxWorkers" apps/*/vitest.config.ts packages/*/vitest.config.ts` → confirms 3 / 2 / 2 / 1 / 1, matching your new comment.
- `pnpm test` → still runs all five suites, all pass (proves the JSONC comment edit didn't break parsing).

### Step 4: Add a turbo cache to CI

**Precondition**: `.github/workflows/ci.yml` has no `actions/cache` step. If one
exists, SKIP.

Add an `actions/cache` step AFTER `Install` and BEFORE `Typecheck` in the
`check` job. Shape (adjust paths per the verification below):

```yaml
- name: Turbo cache
  uses: actions/cache@v4
  with:
    path: .turbo
    key: turbo-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ github.sha }}
    restore-keys: |
      turbo-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-
      turbo-${{ runner.os }}-
```

**Do not guess the cache path.** Verify it for the installed turbo version
(`turbo@^2.10.4`, root `package.json:24`) before committing:

1. `rm -rf .turbo && pnpm build` (local, one time).
2. `find . -maxdepth 3 -name ".turbo" -not -path "*/node_modules/*"` → confirms
   which dirs turbo actually writes. At `91347c66` this produced a root `.turbo`
   **and** a per-package `.turbo` in every workspace.
3. `ls .turbo` → confirm a `cache/` subdir exists (that's the artifact store; the
   per-package `.turbo` dirs hold task logs). If turbo writes its cache
   somewhere else on this version, cache THAT path — and if the layout differs
   from the above, report it rather than caching a guess.

If per-package `.turbo` dirs matter for cache hits, cache them too:

```yaml
path: |
  .turbo
  apps/*/.turbo
  packages/*/.turbo
```

Leave every other CI step alone — in particular the `test` step and its
`"cache": false` turbo task (deliberate; see step 3).

**Verify**:

- `git diff .github/workflows/ci.yml` → only the new cache step added; no other step changed.
- YAML parses: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exit 0 (or `actionlint` if installed → no errors).
- Locally prove the cache is real: `rm -rf .turbo && pnpm build` (cold, note the time), then `pnpm build` again → turbo reports `FULL TURBO` / cache hits and finishes in a fraction of the time. If the second run is NOT a cache hit, the cache step is pointless — STOP and report.
- Cache effectiveness in CI can't be verified locally; say so in your report.

### Step 5: Add a dev-port cleanup script

**Precondition**: no port-killing script exists (`grep -rn "9222" apps/desktop/package.json package.json` shows only the `dev` script's `--remoteDebuggingPort 9222`). If a kill script exists, SKIP.

Add a script to `apps/desktop/package.json` that frees 9222 (Electron CDP) and
47888 (executor daemon).

**macOS constraint — this is the whole difficulty**: BSD `xargs` has **no `-r`**
flag, so the common `lsof -ti:9222,47888 | xargs -r kill` recipe from Linux
_errors on the empty case_ (it runs `kill` with no args). A cleanup script that
fails when nothing is listening is worse than no script — people will stop
trusting its exit code. Guard the empty case explicitly, e.g.:

```json
    "kill-ports": "pids=$(lsof -ti tcp:9222,tcp:47888 || true); if [ -n \"$pids\" ]; then kill $pids; echo \"killed: $pids\"; else echo 'nothing listening on 9222/47888'; fi"
```

Note `lsof` exits **1** when it finds nothing — hence the `|| true`. If the
quoting gets ugly inside JSON (it will), prefer a small
`apps/desktop/scripts/kill-dev-ports.mjs` (node, no new deps — `node:child_process`

- `node:net`) alongside the two existing `verify-*.mjs` scripts and point the
  package script at it. kebab-case filename either way.

You MUST test all three cases on this machine:

1. Nothing listening → script prints the "nothing listening" line and exits **0**.
2. Something listening → the process dies and the port frees.
3. Re-run right after case 2 → back to case 1, exit 0 (idempotent).

**Optional, and ONLY if you can do it safely**: also clear a stale
`~/.inteligir/host.lock`. The lock is a **pidfile** and the app **already
reclaims stale locks from dead pids automatically**
(`docs/development.md:64-67`) — so this is a convenience, not a fix. If you add
it, it must read the pid, check it's actually dead (`process.kill(pid, 0)`
throwing `ESRCH`), and only then unlink. **Never blindly delete the lock file** —
deleting a LIVE lock lets two hosts run against one vault. If that check feels
at all uncertain, leave the lock alone entirely; the ports are the documented
pain.

Then add ONE line to `docs/development.md` in the "Ports & shared state" section
(right after the "Kill leftovers between runs" sentence at line 66-67) pointing
at the script, e.g.:
"`pnpm --filter @repo/desktop kill-ports` frees 9222/47888 (safe to run when nothing is listening)."

**Verify**:

- `pnpm --filter @repo/desktop kill-ports` with nothing running → exit 0, prints the empty-case message. Run it twice.
- Start the app (`pnpm dev:desktop`), confirm `lsof -ti tcp:9222` prints a pid, run `pnpm --filter @repo/desktop kill-ports`, then `lsof -ti tcp:9222` → no output. (If you can't launch Electron in this environment, simulate with any listener on 9222 — e.g. `node -e "require('node:net').createServer().listen(9222)"` — and say so in your report.)
- `pnpm knip` → exit 0 (if you added a `.mjs`, knip's desktop workspace already globs `scripts/**/*.mjs` as an entry — `knip.json`, `apps/desktop.entry` — so it should be covered; if knip complains, report rather than adding a blanket ignore).
- `grep -n "kill-ports" docs/development.md` → one match.

### Step 6: Move shared specs into the pnpm catalog

**Precondition**: the six duplicate specs listed in "Current state" finding 6
still read exactly as excerpted. If any has drifted to a different version, SKIP
that entry (do NOT unify versions — that's a bump, which is out of scope) and
note it.

1. Add to `catalog:` in `pnpm-workspace.yaml` (keep the existing alphabetical
   ordering):
   - `react-day-picker: ^10.0.1`
   - `remark-gfm: ^4.0.1`
   - `remark-parse: ^11.0.0`
2. Replace the literal specs with `"catalog:"` in:
   - `apps/desktop/package.json:68` (`react-day-picker`)
   - `packages/ui/package.json:30` (`react-day-picker`)
   - `packages/core/package.json:42,44` (`remark-gfm`, `remark-parse`)
   - `packages/features/package.json:23,24` (`remark-gfm`, `remark-parse`)
3. Change the catalog's `@types/node` from `^26.1.1` to `^24` (matching
   `engines.node: ">=24"`). All four consumers already use `catalog:`, so this
   is a one-line change. Expect typecheck to be the judge here — see STOP
   conditions.
4. `pnpm install` → regenerates `pnpm-lock.yaml`. **Commit the lockfile.**

Versions must not change (except the deliberate `@types/node` range). Do NOT
touch the `@types/react` catalog entry or override, and do NOT touch the `pi`
packages.

**Verify**:

- `grep -rn "react-day-picker\|remark-gfm\|remark-parse" apps/*/package.json packages/*/package.json` → every hit is `"catalog:"`, none is a literal version.
- `pnpm install` → exit 0, resolves cleanly.
- `pnpm install --frozen-lockfile` → exit 0 (proves the committed lockfile matches the manifests — this is exactly what CI runs, `.github/workflows/ci.yml:25-27`).
- `pnpm typecheck` → exit 0. **This is the real test of the `@types/node` downgrade.** If it fails with missing node APIs, see STOP conditions.
- `pnpm test && pnpm build` → all pass (proves the dedup didn't change what actually resolves).

### Step 7: Gates

`pnpm format:fix` FIRST, then
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`.

**Verify**: every command exits 0. Commit after the gates, never re-format after.

## Test plan

No new unit tests — none of these six changes has runtime behavior in the
product. The verification is the gate suite plus the per-step commands above.
Two changes DO need hands-on verification because they can't be typechecked:

- **Step 4 (CI cache)**: prove locally that a second `pnpm build` is a turbo
  cache hit (`FULL TURBO`). If it isn't, the cache step is decoration.
- **Step 5 (kill-ports)**: exercise all three cases (nothing listening →
  something listening → nothing listening), confirming exit 0 each time. The
  empty case is the one that breaks on macOS.

## Done criteria

Machine-checkable. ALL must hold (for the steps you did NOT skip):

- [ ] `grep -c "pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build" README.md` → `0` (old wrong gate gone)
- [ ] `grep -n "format:fix" README.md` → matches; README gate sequence is byte-identical to `docs/development.md:72-73`
- [ ] `grep -n "apps/cloud\|apps/mobile\|packages/core" README.md` → all three present; every README link added resolves to a file that exists
- [ ] `grep -n "desktop 4" turbo.json` → no matches
- [ ] `.github/workflows/ci.yml` contains an `actions/cache` step for the turbo cache, placed after Install and before Typecheck; the `test` step and `"cache": false` are unchanged
- [ ] `pnpm --filter @repo/desktop kill-ports` exits 0 when nothing is listening AND actually frees 9222/47888 when something is
- [ ] `grep -rn "\"react-day-picker\"\|\"remark-gfm\"\|\"remark-parse\"" apps packages --include=package.json` → every value is `"catalog:"`
- [ ] `pnpm install --frozen-lockfile` exits 0 (lockfile committed and consistent)
- [ ] `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` → all exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] Any skipped step is named in your report with the reason (precondition mismatch)
- [ ] `plans/README.md` status row updated (if the index exists)

## STOP conditions

Stop and report back (do not improvise) if:

- **Step 6, `@types/node` → `^24`**: `pnpm typecheck` fails with missing Node
  APIs. That means source code genuinely depends on Node 26-era typings while
  `engines.node` says `>=24` — a real inconsistency this plan can't resolve
  unilaterally. Revert the `@types/node` line to `^26.1.1`, keep the rest of
  step 6, and report the specific failing APIs.
- **Step 6, `pnpm install` fails to resolve** after the catalog moves, or
  `pnpm install --frozen-lockfile` still fails after you committed the
  regenerated lockfile.
- **Step 6 reveals the "duplicate" specs are NOT identical** (e.g. desktop wants
  `^10.0.1` but ui wants `^10.1.0`). Unifying them would be a version bump —
  out of scope. Skip that entry and report.
- **Step 4**: turbo's cache directory is not `.turbo` on the installed version,
  or a warm `pnpm build` is not a cache hit locally. Report what you observed
  instead of caching a guessed path.
- **Step 5**: you cannot make the script exit 0 on the empty case on macOS after
  two attempts. A cleanup script that fails when there's nothing to clean is
  worse than none — report instead of shipping it.
- **Step 5**: the `host.lock` liveness check is anything less than certain.
  Drop the lock handling; keep the ports.
- Any step's "Current state" excerpt doesn't match the live code → SKIP that
  step (this one you may handle yourself — note it and continue). Only STOP if
  MOST steps have drifted, which means the plan is stale as a whole.
- `pnpm knip` newly fails after any step (a script or dep you added looks unused
  to knip). Report before adding an ignore entry — knip config is a shared
  contract.

## Maintenance notes

For the human/agent who owns this after it lands:

- **The gate sequence now lives in two places** (`README.md` and
  `docs/development.md`) plus `CLAUDE.md`. That duplication is deliberate (the
  operator prefers flat docs — no `CONTEXT.md`, no ADR dir), but it means the
  next person to change the gates must change all three. The README's pointer to
  `docs/development.md` is the mitigation.
- **The turbo cache key** is lockfile+SHA with restore-keys. If build inputs
  ever depend on something outside the lockfile (a generated file, an env var
  not in `globalEnv`), the key needs it too or CI will serve a stale cache.
  `turbo.json`'s `globalEnv: ["PORT"]` / `globalPassThroughEnv` are the current
  contract.
- **The vitest worker budget** (`desktop 3, features/core 2, cloud/mobile 1`) is
  tuned for a ~10-core machine. If a suite is added or a config's `maxWorkers`
  changes, update the `turbo.json` comment too — that's exactly the drift this
  plan fixed once already.
- **Deliberately deferred** (do not fold in without their own verification
  loop): the `@expo/dom-webview` and `lightningcss` pnpm overrides — both need a
  real mobile/web build to prove they can be dropped or bumped. The `pi`
  packages are handled by `plans/002-pi-scope-migration.md`.
- A reviewer should scrutinize: the CI cache step's path/key (the only change
  that can silently do nothing or, worse, serve stale artifacts), and the
  `@types/node` range change (typecheck is the only guard).
