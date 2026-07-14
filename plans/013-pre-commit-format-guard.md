# Plan 013: Add a pre-commit hook that enforces the format-before-gates rule

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index (or the index doesn't exist yet — then skip it).
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- package.json docs/development.md .oxfmtrc.json knip.json`
> Also re-run the "no hook tooling exists" checks in "Current state" — if a git
> hook manager has been added since this plan was written, STOP: the plan's
> premise is gone.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/012-repo-hygiene-batch.md` — **soft** dependency. 012
  fixes the `README.md` block that documents the format-first rule this hook
  enforces; landing 013 first just means the README is briefly wrong about a
  rule the hook now enforces. They can land in either order, independently.
- **Category**: dx
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

The repo's most-bitten rule is **`pnpm format:fix` FIRST, never after gates** —
`docs/development.md:76-79` records why:

```md
Rules that have bitten before:

- **Format before gates, commit after gates.** A `format:fix` run after green
  gates once corrupted test fixtures and shipped red (#362).
```

CI enforces the formatting as a hard step (`pnpm format` = `oxfmt --check`,
`.github/workflows/ci.yml:40-42`). But locally there is **nothing** — no hook, no
guard, just human discipline. The failure mode is a red CI run minutes after the
push, on a rule everyone already agreed to. A pre-commit hook running the format
**check** turns that into a two-second local failure with an obvious fix
(`pnpm format:fix`). Cheap, boring, and it removes an entire class of wasted CI
cycles.

## Current state

**There is no git-hook tooling in this repo. Verified at `91347c66`:**

- Root `package.json` devDependencies (`package.json:19-26`) — no husky, no
  lefthook, no simple-git-hooks:

```json
  "devDependencies": {
    "dotenv-cli": "^11.0.0",
    "knip": "^6.25.0",
    "oxfmt": "^0.58.0",
    "oxlint": "^1.73.0",
    "turbo": "^2.10.4",
    "typescript": "catalog:"
  },
```

- No root `prepare` script (`package.json:4-18` — scripts are `build`, `clean`,
  `clean:workspaces`, `dev`, `dev:web`, `dev:desktop`, `lint`, `lint:fix`,
  `format`, `format:fix`, `knip`, `test`, `typecheck`).
- No `.husky/`, no `lefthook.yml`, no `.githooks/` (all three: "No such file or
  directory").
- `git config --get core.hooksPath` → `/Users/kyh/Documents/Projects/inteligir/.git/hooks`
  — i.e. it is set **in this clone's `.git/config`** to the default location.
  That's effectively default behavior (hooks run from `.git/hooks`), and
  `.git/hooks` currently contains **only** `*.sample` files. Two consequences
  you must handle: (a) any manager that installs into `.git/hooks` works
  unchanged; (b) a `.githooks/`-based approach must run
  `git config core.hooksPath .githooks`, which **overrides** the existing local
  value — fine, but it is a per-clone manual step (see "Tool choice").

The scripts the hook will call (root `package.json:12-14`):

```json
    "lint": "oxlint --report-unused-disable-directives",
    "format": "oxfmt --check",
    "format:fix": "oxfmt --write",
```

### CRITICAL CONSTRAINT — the byte-pinned fixtures

`apps/desktop/src/renderer/__tests__/fixtures/` holds round-trip fixtures whose
**bytes ARE the test contract** (trailing spaces, indentation, line endings).
`docs/development.md:80-84`:

```md
- **Never hand-edit or format round-trip fixtures**
  (`apps/desktop/src/renderer/__tests__/fixtures/`): their bytes ARE the test contract
  (trailing spaces, indentation, line endings). oxfmt ignores the directory;
  editors must too.
```

They are already excluded from oxfmt — `.oxfmtrc.json:3-19`:

```json
  "ignorePatterns": [
    "dist",
    "node_modules",
    "pnpm-lock.yaml",
    "*.tsbuildinfo",
    ".output",
    ".tanstack",
    "out",
    "routeTree.gen.ts",
    "worker-configuration.d.ts",
    "apps/desktop/src/renderer/__tests__/fixtures",
    ...
  ],
```

**Therefore the hook MUST call the existing `pnpm format` script** — which runs
`oxfmt --check` and honors `.oxfmtrc.json`'s `ignorePatterns`. Do **not**
hand-roll an `oxfmt` invocation over a staged-file list: a per-file invocation
can bypass the ignore patterns and start reporting the fixtures as unformatted,
which pressures someone into "fixing" them — the exact corruption of #362.

### The other half of the constraint: the hook must NEVER write

Run the **check** (`pnpm format`), not `format:fix`. A hook that rewrites files
mid-commit is precisely the hazard #362 warns about (formatting applied at the
wrong moment, silently, to files nobody re-tested). The hook must **FAIL**, print
`run: pnpm format:fix`, and let the human do it. No `git add` from inside the
hook. Ever.

### Conventions that apply

- kebab-case filenames; no `any`, no `!`, no `as`; no barrel files.
- Conventional commits (`git log`: `fix(desktop): commit workspace refs`).
- Flat docs, deliberately: `CLAUDE.md` + `docs/development.md` + PR bodies are
  the record. Do NOT create `docs/adr/`, `CONTEXT.md`, or any new doc file — they
  were deliberately deleted. Document the hook **inside `docs/development.md`**.

## Commands you will need

| Purpose                               | Command                                                            | Expected on success          |
| ------------------------------------- | ------------------------------------------------------------------ | ---------------------------- |
| Install (also runs `prepare`)         | `pnpm install`                                                     | exit 0                       |
| Format (run FIRST, never after gates) | `pnpm format:fix`                                                  | exit 0                       |
| Format CHECK — what the hook runs     | `pnpm format`                                                      | exit 0, no unformatted files |
| Lint                                  | `pnpm lint`                                                        | exit 0                       |
| Typecheck                             | `pnpm typecheck`                                                   | exit 0                       |
| Dead code                             | `pnpm knip`                                                        | exit 0                       |
| Tests                                 | `pnpm test`                                                        | all pass                     |
| Build                                 | `pnpm build`                                                       | exit 0                       |
| Inspect installed hook                | `cat .git/hooks/pre-commit` (or `git config --get core.hooksPath`) | the hook you installed       |

## Scope

**In scope** (the only files you should modify):

- `package.json` (root) — `prepare` script; devDependency **only if** you pick a
  hook manager
- The hook config, ONE of:
  - `lefthook.yml` (root), or
  - `.githooks/pre-commit` (executable, dependency-free option)
- `docs/development.md` — document the hook + how to bypass it
- `pnpm-lock.yaml` (regenerated by `pnpm install` if you add a devDependency — commit it)
- `knip.json` — **only if** knip flags the new devDependency as unused (see STOP conditions)

**Out of scope** (do NOT touch, even though they look related):

- `.github/workflows/ci.yml` — CI is already correct (`format` runs as a hard,
  independent step). This plan adds a _local_ guard, not a CI change.
- The gates themselves — no new gate, no reordering, no change to the `format` /
  `format:fix` / `lint` scripts.
- **Formatting any existing file.** If `pnpm format` currently fails on a file,
  that is a pre-existing condition — report it, do not "fix" it under this plan.
- `apps/desktop/src/renderer/__tests__/fixtures/**` — never touched, never
  checked, never reformatted. If your hook makes oxfmt look at these files, the
  hook is wrong.
- `.oxfmtrc.json` — its `ignorePatterns` are correct; the hook must inherit them,
  not restate them.
- A `commit-msg` hook, a `pre-push` hook, or any other hook. One hook:
  `pre-commit`.

## Git workflow

- Branch: `kyh/plan-013-pre-commit-format-guard`
- Conventional commit, e.g. `chore(dx): add a pre-commit format check`
- Do NOT push or open a PR unless the operator instructed it.
- You will be making test commits to verify the hook. Clean them up: the branch
  must end with exactly the intended commit(s) and a clean `git status`.

## Tool choice — pick ONE, justify it in your commit body

Adding a devDependency is normally the operator's call, but a hook manager is the
literal intent of this plan, so choosing one is in scope. Options, in the order
you should prefer them:

1. **lefthook** (recommended). Single Go binary, no per-hook node startup cost,
   one `lefthook.yml`, self-installs from a `prepare` script. Fast enough that
   nobody disables it — the property that actually determines whether a hook
   survives.
2. **simple-git-hooks**. Zero-config, tiny, hooks declared inline in
   `package.json`. Pick this if you want the smallest possible surface and don't
   mind that it re-writes `.git/hooks` on `prepare`.
3. **Dependency-free fallback**: a committed `.githooks/pre-commit` (executable
   shell script) + a one-time
   `git config core.hooksPath .githooks` per clone. **Tradeoff, state it plainly
   in the docs**: nothing installs it automatically, so every fresh clone needs
   the manual `git config` step — and people forget, which means the guard
   silently doesn't exist for them. Choose this only if you want zero new deps
   and are willing to accept a hook that is off by default on new machines. Note
   this clone already has `core.hooksPath` set to `.git/hooks` in `.git/config`,
   so the setup command must override it.

**Do NOT pick husky** — heavier, spreads shell scripts across `.husky/`, and
brings nothing the other two lack here.

Whichever you pick: wire self-install via a root `prepare` script so
`pnpm install` sets it up (option 3 can't do this — that's its cost).

## Steps

### Step 1: Establish the baseline

Confirm the repo is currently format-clean, so any later failure is your test
file and not a pre-existing one.

**Verify**:

- `pnpm format` → exit 0. If it FAILS, STOP (see STOP conditions) — do not
  reformat anything.
- `git status` → clean.
- `ls .husky lefthook.yml .githooks 2>/dev/null` → nothing (confirms the plan's
  premise still holds).

### Step 2: Install the hook manager and wire `prepare`

Per your choice above.

**If lefthook**: add `lefthook` to root `package.json` devDependencies, add
`"prepare": "lefthook install"` to root scripts, and create `lefthook.yml` at the
repo root:

```yaml
# Local guard for the rule that has bitten before: format BEFORE the gates,
# never after (a format:fix after green gates once corrupted the byte-pinned
# round-trip fixtures and shipped red — #362, see docs/development.md).
#
# This runs the CHECK (`pnpm format` = oxfmt --check), never the fix. A hook
# that rewrites files mid-commit IS the hazard. It fails; you run
# `pnpm format:fix` yourself. Bypass with `git commit --no-verify`.
pre-commit:
  parallel: true
  commands:
    format:
      run: pnpm format
      fail_text: "Unformatted files. Run: pnpm format:fix"
```

Note there is deliberately **no `glob:`/`files:` filter and no `{staged_files}`
interpolation** — passing a file list to oxfmt can bypass `.oxfmtrc.json`'s
`ignorePatterns` and drag the byte-pinned fixtures into the check. Running the
repo-wide `pnpm format` script is the safe path, and it's fast.

**If simple-git-hooks**: devDependency + `"prepare": "simple-git-hooks"` +

```json
  "simple-git-hooks": {
    "pre-commit": "pnpm format"
  }
```

**If `.githooks/pre-commit`** (dependency-free): a `#!/bin/sh` script that runs
`pnpm format` and exits non-zero with the `pnpm format:fix` hint on failure;
`chmod +x .githooks/pre-commit`; document the one-time
`git config core.hooksPath .githooks`. No `prepare` script (nothing to install).

Then: `pnpm install` (runs `prepare`).

**Verify**:

- `pnpm install` → exit 0.
- The hook is actually installed: `cat .git/hooks/pre-commit` → shows the
  manager's shim (lefthook / simple-git-hooks). For the `.githooks` option:
  `git config --get core.hooksPath` → `.githooks`.
- `pnpm knip` → exit 0. (knip has plugins for the common hook managers; if it
  flags the new devDependency as unused, see STOP conditions.)

### Step 3: Decide on lint-in-the-hook (measure, don't guess)

Optional. `pnpm lint` (`oxlint --report-unused-disable-directives`) in the hook
catches lint errors before CI too — but only if it's fast. **Measure it**:

```bash
time pnpm lint
```

Rule of thumb: if it adds **more than ~2 seconds** to every commit, leave it to
CI and keep the hook format-only. A slow hook gets `--no-verify`'d into
irrelevance, which costs you the format guard too. Record the measured number in
your report and in the commit body.

If you include it, add it as a second `pre-commit` command (lefthook runs them in
parallel), same rules: check only, never `lint:fix`, never `git add`.

**Verify**: `time pnpm lint` → note the wall-clock seconds; state your decision
and the number.

### Step 4: Prove the hook blocks an unformatted file

Create a deliberately badly-formatted **scratch** file OUTSIDE the fixtures dir
(e.g. `scratch-format-check.ts` at the repo root — an oxfmt-covered path;
something like `const   x={a:1,   b:2,};;` with ragged spacing), stage it, and
try to commit.

```bash
# 1. unformatted scratch file, staged
git add scratch-format-check.ts
git commit -m "test: should be blocked"        # must FAIL
```

Then prove the escape hatch and clean up:

```bash
git commit -m "test: bypass" --no-verify        # must SUCCEED
git reset --hard HEAD~1                         # undo the test commit
rm -f scratch-format-check.ts
git status                                      # must be clean (bar your real changes)
```

**Verify** — all four must hold:

- The plain `git commit` **fails**, exit non-zero, prints the "run `pnpm format:fix`" hint, and **creates no commit** (`git log -1` unchanged).
- `git commit --no-verify` **succeeds** (the emergency escape works — a hook that can't be skipped gets uninstalled).
- The hook **modified nothing**: after the failed commit, `git diff` on the scratch file shows it still holds your ugly bytes (the hook checked; it did not write).
- `git status --porcelain apps/desktop/src/renderer/__tests__/fixtures/` → **empty**. The fixtures were not touched. Check this explicitly — it is the single most important assertion in this plan.
- After cleanup: `git status` → clean, no `scratch-format-check.ts` anywhere, no stray test commit in `git log`.

### Step 5: Document it in `docs/development.md`

Add a short paragraph under "Quality gates" → "Rules that have bitten before"
(`docs/development.md:76-87`), stating:

- a `pre-commit` hook runs `pnpm format` (the CHECK) and blocks the commit if
  anything is unformatted; the fix is `pnpm format:fix`;
- it never writes to your files;
- `git commit --no-verify` bypasses it (emergencies, WIP commits);
- how it gets installed (`pnpm install` runs `prepare` → the manager installs the
  hook). **If you chose `.githooks`**: document the one-time
  `git config core.hooksPath .githooks` prominently in Prerequisites
  (`docs/development.md:6-11`) too, since a fresh clone has no guard until
  someone runs it.

Do NOT create a new doc file.

**Verify**: `grep -n "no-verify" docs/development.md` → one match, in the section
you added.

### Step 6: Gates

`pnpm format:fix` FIRST, then
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`.

**Verify**: every command exits 0. Then commit (the hook will run on your own
commit — it should pass, which is itself a live confirmation).

## Test plan

No unit tests — a git hook has no importable surface. The test is the manual
protocol in **Step 4**, and it is mandatory:

1. **Blocks**: staged unformatted file → `git commit` fails, no commit created.
2. **Bypassable**: `git commit --no-verify` on the same file succeeds.
3. **Read-only**: the hook modifies zero files (`git diff` after the failed
   commit is unchanged; no `git add` happened behind your back).
4. **Fixtures untouched**: `git status --porcelain apps/desktop/src/renderer/__tests__/fixtures/`
   is empty at every point.
5. **Happy path**: a properly formatted change commits normally (your own real
   commit in step 6 proves this).
6. **Clean up**: scratch file deleted, test commits removed, `git status` clean.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] A `pre-commit` hook is installed by `pnpm install` (`cat .git/hooks/pre-commit` shows it — or `git config --get core.hooksPath` → `.githooks` for the dependency-free option)
- [ ] The hook runs `pnpm format` (the CHECK). `grep -rn "format:fix" lefthook.yml .githooks/pre-commit package.json` shows `format:fix` ONLY in the root `scripts` block and in hint text — the hook never _executes_ it
- [ ] Staging an unformatted file and running `git commit` → non-zero exit, no commit created
- [ ] `git commit --no-verify` on the same staged file → succeeds
- [ ] The hook writes to no file (verified after a blocked commit: `git diff` unchanged)
- [ ] `git status --porcelain apps/desktop/src/renderer/__tests__/fixtures/` → empty
- [ ] No scratch/test artifacts remain: `git status` clean; `git log` has no `test:` commits
- [ ] `pnpm install --frozen-lockfile` exits 0 (lockfile committed, if a dep was added)
- [ ] `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` → all exit 0
- [ ] `docs/development.md` documents the hook and the `--no-verify` bypass
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated (if the index exists)

## STOP conditions

Stop and report back (do not improvise) if:

- **`pnpm format` fails on the clean tree in Step 1.** The repo is already
  unformatted. Formatting existing files is explicitly out of scope for this
  plan — report which files and stop. (Do NOT "just run format:fix and commit
  it" — that mixes a formatting sweep into a DX change and is how #362
  happened.)
- **The hook reports the byte-pinned fixtures as unformatted.** Your invocation
  is bypassing `.oxfmtrc.json`'s `ignorePatterns` (almost certainly by passing a
  file list to oxfmt instead of calling `pnpm format`). Fix the invocation. NEVER
  "fix" the fixtures.
- **The hook modifies any file.** It must be check-only. If your manager's
  default template does a `git add` / `--write`, remove it or switch tools.
- **`git commit --no-verify` does not bypass the hook.** An unskippable hook is
  worse than none.
- **`pnpm knip` flags the new devDependency as unused** and you'd have to add it
  to a knip ignore list. `knip.json` is a shared contract — report first with the
  exact knip output; the operator may prefer the dependency-free `.githooks`
  option over a knip exception.
- **A hook manager already exists** (drift since `91347c66`) — the plan's premise
  is void.
- The hook adds more than a couple of seconds to a commit even in format-only
  mode (something is wrong — `oxfmt --check` on this repo is fast).

## Maintenance notes

For the human/agent who owns this after it lands:

- **The hook is a convenience, not the enforcement.** CI's `format` step
  (`.github/workflows/ci.yml:40-42`) is the actual gate and must stay. `--no-verify`
  exists precisely so the hook can never block an emergency — that's a feature.
- **Do not "upgrade" the hook to `format:fix`.** Every few months someone
  proposes auto-formatting on commit. The byte-pinned round-trip fixtures
  (`apps/desktop/src/renderer/__tests__/fixtures/`) are why the answer is no:
  their bytes are the test contract, and a hook that writes during a commit is
  exactly the #362 failure. Check, fail, hint. That's the design.
- **If new ignore paths are added to `.oxfmtrc.json`**, the hook inherits them
  automatically — _because_ it shells out to `pnpm format` rather than
  reimplementing the file selection. Keep it that way; the moment the hook grows
  its own file list, it can drift from the formatter's config.
- **Deferred deliberately**: a `commit-msg` hook enforcing conventional commits,
  and staged-file-scoped linting. Both are plausible later; neither is worth the
  latency or the drift risk today.
- A reviewer should scrutinize: that the hook cannot write (no `--write`, no
  `git add`), that `--no-verify` works, and that nothing in the diff touches the
  fixtures directory.
