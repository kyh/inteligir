# Plan 002: Make CI run the full gate (build included) and report every gate independently

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- .github/workflows/ci.yml CLAUDE.md docs/development.md`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

Two CI gaps: (1) CI never runs `pnpm build`, so Electron/Worker/mobile bundler
breakage merges green and is discovered at release time; (2) the gate steps run
sequentially and a failing step aborts the job, so a trivial format failure
hides test results (documented in `docs/development.md` as a known hazard,
never fixed). Additionally the "canonical" quality-gate command differs across
CLAUDE.md, development.md, and CI — three different orderings/step-sets.

## Current state

- `.github/workflows/ci.yml` — one `check` job; steps (in order): checkout,
  pnpm/action-setup, setup-node (node 24, pnpm cache), `pnpm install
--frozen-lockfile`, then:

  ```yaml
  - name: Typecheck
    run: pnpm typecheck

  - name: Lint
    run: pnpm lint

  - name: Knip (dead code)
    run: pnpm knip

  - name: Format check
    run: pnpm format

  - name: Test
    run: pnpm test
  ```

  No build step. No `if:` conditions anywhere.

- `CLAUDE.md` § "Quality Gates" documents:
  `pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build` (no
  `format`).
- `docs/development.md` § "Quality gates" documents:
  `pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm knip && pnpm build`,
  plus this stale sentence (turbo.json sets `test` to `cache: false`, so it is
  false): "Turbo caches test results — pass `--force` when you need proof over
  speed." It also documents the hazard this plan fixes: "CI runs the same
  gates; format-check failures **skip the test step** ...".
- The desktop build task in `turbo.json` declares env
  `INTELIGIR_GOOGLE_OAUTH_CLIENT_ID` / `INTELIGIR_GOOGLE_OAUTH_CLIENT_SECRET` —
  the build must succeed WITHOUT these being set (they are optional at build
  time). If it doesn't, that's a STOP condition, not something to work around
  by adding secrets.

## Commands you will need

| Purpose   | Command                                                                              | Expected on success                                     |
| --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Install   | `pnpm install`                                                                       | exit 0                                                  |
| Build     | `pnpm build`                                                                         | exit 0 (run locally first to confirm it passes at HEAD) |
| Full gate | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0                                                  |

## Scope

**In scope**:

- `.github/workflows/ci.yml`
- `CLAUDE.md` (only the Quality Gates command line)
- `docs/development.md` (only the Quality gates section)
- `plans/README.md` (status row)

**Out of scope**:

- `.github/workflows/deploy.yml` — deploy flow is owner-only, leave it.
- `turbo.json` — enabling test caching is a separate judgment call
  (see "Findings considered and rejected" in plans/README.md).
- Adding any repository secrets.

## Git workflow

- Branch: `kyh/plan-002-ci-gates`
- Commit style: `ci: run build + report all gates independently`

## Steps

### Step 1: Confirm build is green at HEAD

Run `pnpm build` locally. If it fails, STOP and report (the plan assumes a
green baseline).

**Verify**: `pnpm build` → exit 0

### Step 2: Rework ci.yml gate steps

Keep the single `check` job. Order the steps: Typecheck, Lint, Knip, Format
check, Test, Build. Add `if: ${{ !cancelled() }}` to every gate step AFTER the
first (Lint, Knip, Format check, Test, Build) so each reports even when an
earlier gate fails. Leave `pnpm install` and checkout/setup steps untouched
(if install fails, `!cancelled()` steps would still run and all fail noisily —
avoid that by gating the five gate steps on install success too:
`if: ${{ !cancelled() && steps.install.outcome == 'success' }}` with
`id: install` added to the install step).

The Build step is exactly `run: pnpm build`.

**Verify**: `git diff .github/workflows/ci.yml` shows six gate steps, five with
`if:` conditions; YAML parses (`node -e "require('js-yaml')"` is NOT available —
instead verify with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exit 0).

### Step 3: Unify the documented gate

Pick this canonical order (mirrors CI):

```
pnpm format:fix   # FIRST — never after gates
pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build
```

- In `CLAUDE.md` § Quality Gates: replace the command with the canonical one.
- In `docs/development.md` § Quality gates: replace the command with the same
  canonical one; DELETE the sentence claiming Turbo caches test results
  (`test` is `cache: false` in turbo.json); UPDATE the sentence about
  format-check failures skipping the test step to say all gates now report
  independently in CI.

**Verify**: `grep -c "pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build" CLAUDE.md docs/development.md` → 1 match in each

### Step 4: Gates

`pnpm format:fix` then the full canonical gate.

**Verify**: exit 0

## Done criteria

- [ ] ci.yml contains a `pnpm build` step
- [ ] Every gate step after the first has an `if:` that keeps it running on prior failure
- [ ] CLAUDE.md and development.md agree on one gate command; the stale turbo-cache sentence is gone
- [ ] Full local gate exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- `pnpm build` fails at HEAD (report the failure — it is itself finding #2 made real).
- The desktop build demands the Google OAuth env vars to be set.
- ci.yml has drifted from the excerpt.

## Maintenance notes

- CI wall-time will grow by the build (locally measure once and note it in the
  PR). If it becomes painful, split Build into a parallel job with its own
  checkout/install rather than dropping it.
- Reviewer: check `!cancelled()` semantics — the job must still FAIL when any
  gate fails (each step failing marks the job failed; `!cancelled()` only keeps
  later steps running).
