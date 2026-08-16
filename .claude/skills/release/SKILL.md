---
name: release
description: Bump, build, notarize, and ship a new version of the Inteligir Electron desktop app to GitHub Releases — the electron-updater feed installed clients auto-download from. Use when the user wants to cut/ship a desktop release. Args optional: bump type, e.g. "release patch", "release minor".
allowed-tools: Bash(*), Read, Edit, Write
---

# Release

Cut a new version of the Inteligir desktop app and publish it to GitHub Releases.

**Publishing IS distribution.** `apps/desktop/src/main/updater.ts` sets
`autoDownload = true` and `autoInstallOnAppQuit = true`: an installed client checks the feed on a
15s startup delay and from "Check for Updates…", downloads what it finds, and offers "Restart
now" / "Later" — and a declined restart still installs on the next quit. So a release reaches
users on its own. Step 7's report block says the same thing; keep the two in agreement.

That makes step 6 the load-bearing check rather than a formality: electron-updater installs only
from the **zip** listed in `latest-mac.yml` (the dmg is first-install only), so a release whose
zip is missing or unlisted strands every install on its current version.

## Context

- Repo root: `/Users/kyh/Documents/Projects/inteligir`
- The shipping artifact is the Electron SHELL at `apps/desktop` (`@repo/desktop`) — a window on the hosted product. It carries no vault, no agent and no index, so what a bump changes is the window and its update feed. The product itself ships by deploying `apps/web`, which is a different act.
- Version of record: `version` in `apps/desktop/package.json`. The repo root has no version field.
- Tag scheme: `v<version>` (e.g. `v0.3.0`) — electron-builder creates this tag + GitHub release.
- Build chain: `electron-vite build` → `electron-builder --mac` (targets `dmg` + `zip` from `electron-builder.yml`; the zip is the auto-update artifact) → publishes to `github:kyh/inteligir` as a live release.
- **macOS only.** electron-builder notarizes (`notarize: true`) — needs Apple creds from `apps/desktop/.env` (loaded via `with-env`/dotenv) and must run on a Mac. No Windows/Linux targets.
- Existing scripts in `apps/desktop`:
  - `release` — build + package locally, `--publish never` (dry run, no upload)
  - `release:publish` — build + package + `--publish always` (uploads to GitHub), wraps `GH_TOKEN=$(gh auth token)` and the `verify:release` guard
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
- `pnpm format:fix && pnpm verify` on the exact commit being cut. `release`/`release:publish` run the full gate through `verify:release`, so a red gate stops the build rather than shipping past it — but run it HERE anyway: finding out after `electron-vite build` wastes a notarization cycle. Keep `verify:release` wired to the whole gate: anything narrower lets a release be cut while `main` is red.
- Electron fuses + entitlements are only exercised by a real packaged build, so a launch failure in a packaged build points at `enableEmbeddedAsarIntegrityValidation` / `onlyLoadAppFromAsar` — see the comment in `electron-builder.yml`.
- `uname -s` — must be `Darwin`. If not, stop: notarized mac builds require macOS.
- `test -f apps/desktop/.env` — notarization creds live here. If missing, stop and say so.
- The bundled app origin — a release bakes `INTELIGIR_APP_URL` from `.env` into the main bundle (electron-vite `define`). Absent, the shell ships pointing at `https://inteligir.com`, which is usually what you want; a release meant for a different deployment MUST set it:
  ```
  grep -E '^INTELIGIR_APP_URL=.+' apps/desktop/.env | wc -l
  ```
  Prints `1` when set. `0` is fine for a production release and WRONG for any other target — surface which one this is before building.
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

Prepend a new entry to `apps/desktop/CHANGELOG.md` (create if missing). Source bullets from `git log --pretty='- %s' ${LAST:+$LAST..}HEAD -- apps/desktop packages/bridge`, dropping merge commits, previous `release:` commits, and pure dependency bumps. Scope it that way rather than repo-wide: this artifact is the main process alone (`electron.vite.config.ts` declares only a `main` build, and `.output/app/main/index.js` is the whole bundle), whose one workspace dep is `@repo/bridge`. An `apps/web` change ships by deploying the Worker and is not in this build. Format:

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
pnpm install            # defensive — deps may be unlinked after a pull
pnpm -F @repo/desktop release:publish
```

This is the long pole: electron-vite build → electron-builder package → **notarize** (minutes) → upload to GitHub release `v<version>`. For a dry run use `pnpm -F @repo/desktop release` instead (packages to `apps/desktop/.output/bin`, no upload) and skip steps 4/6/7's push/tag — just report the local artifact path.

If the build fails after the bump was pushed: the version bump sits on `main` with no release. That's recoverable — fix the cause and re-run; if the same version then publishes, fine. Do not roll back the bump commit.

### 6. Verify

- `gh release view v<version> --json assets -q '.assets[].name'` — confirm ALL of: `Inteligir-<version>-<arch>.dmg`, `Inteligir-<version>-<arch>-mac.zip`, the zip's `.blockmap`, and `latest-mac.yml`. A dmg-only release strands every install on its version.
- `gh release download v<version> --pattern latest-mac.yml --output -` — confirm the `files:` list includes the `-mac.zip` entry. If the zip asset exists but isn't listed here, electron-updater still fails (`ZIP file not provided`).
- `git fetch --tags` — pull the `v<version>` tag electron-builder created so local matches remote.

### 7. Report

```
Released: Inteligir v<version>
  GitHub release: <url>
  assets: dmg + zip (+ blockmap) + latest-mac.yml (zip listed: yes/no)
Commit: <sha> (pushed to origin/<branch>)
Tag: v<version> (created by electron-builder, fetched locally)
Auto-update: zip is in latest-mac.yml, so installed clients pick this up on
  their own — they check within 15s of launch, download, and prompt to restart
  (declining installs it on the next quit).
  End-to-end update (installed older build → this one) is NOT yet verified;
  say "should" rather than "will" until that's been run once.
  Note: installs of v0.3.0 and earlier shipped from dmg-only releases and
  cannot self-update — they need a manual reinstall.
```

If anything failed, lead with the failure and the exact state: bump pushed? release created? assets uploaded? tag present?

## Rules

- macOS only — notarized builds can't run elsewhere. Don't try to add `--win`/`--linux` without signing config.
- Never narrow the build to dmg-only (e.g. `--mac dmg`) — the zip target in `electron-builder.yml` is what electron-updater installs from.
- Push the bump commit **before** `release:publish`, never after. The tag binds to the remote tip.
- Never `--force` push or amend prior release commits.
- If the upload fails with a version conflict (release already exists), bump again rather than overwrite an existing release.
- `--dry` (`release`) never pushes, tags, or uploads — it's a local smoke test only.
- Bootstrap: if no prior `v*` tag exists, treat all history as the changes, capping changelog bullets at the last 20 commits.
