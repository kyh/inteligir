---
name: release
description: Bump, build, notarize, and ship a new version of the Inteligir Electron desktop app to GitHub Releases (auto-update via electron-updater). Use when the user wants to cut/ship a desktop release. Args optional: bump type, e.g. "release patch", "release minor".
allowed-tools: Bash(*), Read, Edit, Write
---

# Release

Cut a new version of the Inteligir desktop app and publish it to GitHub Releases. Users on the auto-updater (electron-updater) pull the new version from that release, so publishing the release **is** the distribution.

## Context

- Repo root: `/Users/kyh/Documents/Projects/inteligir`
- The only shipping artifact is the Electron app at `apps/desktop` (`@repo/desktop`). The whole monorepo (packages + app) bundles into it.
- Version of record: `version` in `apps/desktop/package.json`. The repo root has no version field.
- Tag scheme: `v<version>` (e.g. `v0.3.0`) — electron-builder creates this tag + GitHub release.
- Build chain: `electron-vite build` → `electron-builder --mac dmg` → publishes to `github:kyh/inteligir` as a live release (see `apps/desktop/electron-builder.yml`).
- **macOS only.** electron-builder notarizes (`notarize: true`) — needs Apple creds from `apps/desktop/.env` (loaded via `with-env`/dotenv) and must run on a Mac. No Windows/Linux targets.
- Existing scripts in `apps/desktop`:
  - `release` — build + package locally, `--publish never` (dry run, no upload)
  - `release:publish` — build + package + `--publish always` (uploads to GitHub), wraps `GH_TOKEN=$(gh auth token)` and the `verify:release`/`verify:packaged` guards
- Current branch: !`git -C /Users/kyh/Documents/Projects/inteligir rev-parse --abbrev-ref HEAD`
- Working tree: !`git -C /Users/kyh/Documents/Projects/inteligir status --short`

## Arguments

Parse from the user message:
- Bump type: `patch`, `minor`, `major`. Default `patch`.
- `--dry` to run `release` (package locally, no upload) instead of `release:publish`, for a smoke test.

If ambiguous, ask in one short sentence before proceeding.

## Process

### 1. Preflight

Run in parallel:
- `gh auth status` — must be authenticated (the publish step pulls `GH_TOKEN` from `gh auth token`). If not, stop and tell the user to `gh auth login`.
- `git status --porcelain` — if dirty in unrelated files, surface and ask whether to proceed.
- `uname -s` — must be `Darwin`. If not, stop: notarized mac builds require macOS.
- `test -f apps/desktop/.env` — notarization creds live here. If missing, stop and say so.
- `gh release view v<current-version>` — sanity check the current version isn't already released.
- Last release + changes since:
  ```
  LAST=$(git tag --list 'v*' --sort=-v:refname | head -1)
  git log --oneline ${LAST:+$LAST..}HEAD
  ```
  If empty (nothing since last tag) and no bump was forced, tell the user there's nothing to ship and stop.

### 2. Bump

Edit `version` in `apps/desktop/package.json`. Keep semver. If a published release is ahead of the local file (out-of-band release), use that as the floor and bump from there.

### 3. Changelog

Prepend a new entry to `apps/desktop/CHANGELOG.md` (create if missing). Source bullets from `git log --pretty='- %s' ${LAST:+$LAST..}HEAD`, dropping merge commits, previous `release:` commits, and pure dependency bumps. The whole repo bundles into the app, so repo-wide log is correct here. Format:

```markdown
# Changelog

## <new-version> — <YYYY-MM-DD>

- <commit subject>
- <commit subject>
```

Terse bullets — sacrifice grammar for concision. If unsure, show the proposed entry before writing.

### 4. Commit + push the bump FIRST

This ordering matters and differs from the npm release skills. electron-builder creates the GitHub release + `v<version>` tag against the **remote** branch tip, so the bump commit must already be pushed:
```
git add apps/desktop/package.json apps/desktop/CHANGELOG.md
git commit -m "release: v<version>"
git push origin <current-branch>
```
Pushing to `main` may trigger other GitHub Actions — fine, releases are intentional. Mention it in the report.

### 5. Build + publish

```
pnpm install            # defensive — native deps (sherpa-onnx) may be unlinked after a pull
pnpm -F @repo/desktop release:publish
```
This is the long pole: electron-vite build → electron-builder package → **notarize** (minutes) → upload to GitHub release `v<version>`. For a dry run use `pnpm -F @repo/desktop release` instead (packages to `apps/desktop/.output/bin`, no upload) and skip steps 4/6/7's push/tag — just report the local artifact path.

If the build fails after the bump was pushed: the version bump sits on `main` with no release. That's recoverable — fix the cause and re-run; if the same version then publishes, fine. Do not roll back the bump commit.

### 6. Verify

- `gh release view v<version>` — confirm the release exists and the `Inteligir-<version>-<arch>.dmg` asset is attached.
- `git fetch --tags` — pull the `v<version>` tag electron-builder created so local matches remote.

### 7. Report

```
Released: Inteligir v<version>
  GitHub release: <url>
  dmg asset: Inteligir-<version>-<arch>.dmg
Commit: <sha> (pushed to origin/<branch>)
Tag: v<version> (created by electron-builder, fetched locally)
Auto-update: electron-updater clients will pick this up
```
If anything failed, lead with the failure and the exact state: bump pushed? release created? assets uploaded? tag present?

## Rules

- macOS only — notarized builds can't run elsewhere. Don't try to add `--win`/`--linux` without signing config.
- Push the bump commit **before** `release:publish`, never after. The tag binds to the remote tip.
- Never `--force` push or amend prior release commits.
- If the upload fails with a version conflict (release already exists), bump again rather than overwrite an existing release.
- `--dry` (`release`) never pushes, tags, or uploads — it's a local smoke test only.
- Bootstrap: if no prior `v*` tag exists, treat all history as the changes, capping changelog bullets at the last 20 commits.
