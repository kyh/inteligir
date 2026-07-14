# Plan 002: Migrate the pi agent framework from the deprecated @mariozechner scope to @earendil-works

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- packages/features/src/server/pi packages/features/package.json apps/desktop/package.json`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: migration / security
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

The pi coding-agent framework is THE critical dependency — it runs the chat agent, delegation background agent, editor AI, and ghost text. The npm scope this repo pins (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai` at `^0.73.1`) is **deprecated** ("please use @earendil-works/pi-coding-agent instead going forward") and frozen at 0.73.1 (2026-05-07). `pnpm audit` reports a HIGH advisory against it (GHSA-jfgx-wxx8-mp94, predictable temp extension-install paths → local privilege escalation, affected `>=0.50.0 <=0.73.1`, patched range "<0.0.0" i.e. **no fix will ever ship on this scope**), plus LOW advisories (XSS in HTML session exports; a race in `auth.json` writes that could expose stored credentials). The successor scope `@earendil-works/pi-coding-agent` is live at 0.80.6 (2026-07-09) and past the vulnerable range. Migrating is the only remediation path.

## Current state

- Manifests pinning the deprecated scope:
  - `packages/features/package.json:16-17` — `"@mariozechner/pi-ai": "^0.73.1"`, `"@mariozechner/pi-coding-agent": "^0.73.1"`
  - `apps/desktop/package.json:77` — `"@mariozechner/pi-ai": "^0.73.1"` (devDependency)
- Import sites (all confined to `packages/features/src/server/pi/` — verified by repo-wide grep):
  - `model.ts:1-2` — `getModels`, types `Api`, `Model` from `pi-ai`
  - `pi-types.ts:5,12,20` — re-exports `SessionManager` + more from `pi-coding-agent`; types from `pi-ai`
  - `auth.ts:1` — `AuthStorage` from `pi-coding-agent`
  - `agent.ts:7,13,14` — values/types from `pi-coding-agent`; types `Api`, `AssistantMessage`, `ImageContent`, `Model` from `pi-ai`
  - `skills.ts:1` — `loadSkills` from `pi-coding-agent`
- `packages/features/src/server/pi/pi-types.ts` is the deliberate facade: the rest of the codebase imports pi types through it, not from the package directly. This is why the blast radius is 5 files.
- Extension bundles registered in `packages/features/src/server/agent/bundles.ts` receive pi APIs indirectly; the packaged agent resources live at `packages/features/resources/agent` (electron-builder `extraResources` — see `docs/development.md:135-141`).
- The desktop release guards: `pnpm verify:release` + `pnpm verify:packaged` in `apps/desktop`.
- Version jump 0.73.1 → 0.80.6 spans 7 minor versions of a pre-1.0 package: expect API drift in the symbols above.

## Commands you will need

| Purpose        | Command                                                                              | Expected                    |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| Install        | `pnpm install`                                                                       | exit 0                      |
| Format         | `pnpm format:fix` (FIRST, never after gates)                                         | exit 0                      |
| Typecheck      | `pnpm typecheck`                                                                     | exit 0                      |
| Features tests | `pnpm --filter @repo/features test`                                                  | all pass                    |
| Audit          | `pnpm audit --prod 2>&1 \| grep -i "pi-coding-agent"`                                | no HIGH hits post-migration |
| Full gates     | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | all exit 0                  |

## Suggested executor toolkit

- The `librarian` skill (if available) to inspect the `@earendil-works/pi-coding-agent` repo for the 0.73→0.80 changelog/breaking changes before editing code.
- `npm view @earendil-works/pi-coding-agent versions` to confirm the current latest before pinning.

## Scope

**In scope**:

- `packages/features/package.json`, `apps/desktop/package.json` (dependency lines only)
- `pnpm-workspace.yaml` — ADD both pi packages to the `catalog:` and reference them via `catalog:` from both manifests (they're pinned independently today; the catalog is this repo's convention for shared versions)
- `packages/features/src/server/pi/*.ts` (the 5 import files) — import specifiers, plus whatever minimal code adjustments the 0.80 API requires
- `pnpm-lock.yaml` (via `pnpm install`)

**Out of scope**:

- Any behavioral change to agent features beyond what the API migration forces.
- `packages/features/src/server/agent/**` extension bundles — only touch if typecheck breaks there, and then only the broken call sites.
- Other dependency bumps (separate plans).

## Git workflow

- Branch: `kyh/plan-002-pi-scope-migration`
- Conventional commits, e.g. `fix(deps): migrate pi to @earendil-works scope (0.80.x)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Repoint manifests via the catalog

Add to `pnpm-workspace.yaml` under `catalog:`:

```yaml
"@earendil-works/pi-coding-agent": ^0.80.6
"@earendil-works/pi-ai": ^0.80.6
```

(Confirm current latest with `npm view @earendil-works/pi-coding-agent version` first; use that.) Replace the two `@mariozechner/*` entries in `packages/features/package.json` and the one in `apps/desktop/package.json` with the `@earendil-works/*` names at `"catalog:"`. Run `pnpm install`.

**Verify**: `pnpm install` → exit 0; `grep -rn "mariozechner" packages/features/package.json apps/desktop/package.json` → no matches.

### Step 2: Update imports

In the 5 files under `packages/features/src/server/pi/`, replace `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent` and `@mariozechner/pi-ai` → `@earendil-works/pi-ai`.

**Verify**: `grep -rn "@mariozechner" packages apps --include='*.ts*'` → no matches.

### Step 3: Reconcile the 0.80 API

Run `pnpm typecheck`. If it fails inside `packages/features/src/server/pi/` (or in code importing `pi-types.ts`), consult the new package's types (`node_modules/@earendil-works/pi-coding-agent/dist/*.d.ts`) and adjust minimally: keep the `pi-types.ts` facade as the single adaptation layer wherever possible — adapt inside the facade rather than rippling renames through consumers.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Behavior check

`pnpm --filter @repo/features test` — the suite covers the agent surface (handlers, delegation, executor). Then `pnpm audit 2>&1 | grep -iA2 "pi"` to confirm the GHSA advisories no longer report.

**Verify**: features suite green; audit shows no pi HIGH advisory.

### Step 5: Full gates + packaging sanity

`pnpm format:fix` FIRST, then full gates. Then in `apps/desktop`: `pnpm verify:release` if it runs without a signing environment (if it requires notarization credentials, skip and note it in the report).

**Verify**: gates exit 0.

## Test plan

No new tests — this is a dependency migration; the existing `@repo/features` suite is the behavioral net. If Step 3 forced a non-trivial adaptation in `pi-types.ts` (signature change, renamed symbol), add one unit test in `packages/features/src/server/__tests__/` pinning the facade's adapted behavior.

## Done criteria

- [ ] `grep -rn "mariozechner" package.json packages apps pnpm-workspace.yaml --include='*.json' --include='*.ts*' --include='*.yaml'` → no matches (lockfile may retain transitive references; that's fine)
- [ ] `pnpm audit` no longer reports GHSA-jfgx-wxx8-mp94
- [ ] Both pi packages resolve via `catalog:`
- [ ] Full gates green
- [ ] `plans/README.md` status row updated

## STOP conditions

- `@earendil-works/pi-*@0.80.x` has breaking changes that require restructuring `agent.ts` beyond mechanical adaptation (e.g. the session/extension model changed shape) — report the specific API diff instead of redesigning the agent layer.
- The new version's `AuthStorage` changes the on-disk format under `~/.inteligir` (auth/session stores) — that risks logging every user out or corrupting stored sessions; report before proceeding.
- Typecheck errors appear OUTSIDE `packages/features/src/server/pi/` and `agent/` — the facade should have contained the blast radius; widespread breakage means the migration needs its own design pass.
- The features test suite fails in a way unrelated to your change (verify on a clean checkout first).

## Maintenance notes

- Per the LOW advisory about `auth.json` write races on the OLD version: after this lands, the operator should treat any long-lived OpenAI OAuth tokens stored by pi under `~/.inteligir` as worth re-issuing (log out/in) out of caution. Do not touch token files in this plan.
- Pre-1.0 cadence is fast; the pi packages are now in the catalog so future bumps are one-line.
- Reviewer: scrutinize `pi-types.ts` diffs — that facade is the contract the rest of the backend compiles against.
