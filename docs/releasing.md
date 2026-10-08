# Releasing

THE runbook. One product version ships as three artifacts, and every step here
is the owner's: each needs a credential no agent and no CI run holds (the
Developer ID and the notary key, npm's one-time code, the Apple team behind
EAS, Cloudflare), and the agent environment refuses release operations
outright.

| Artifact           | Who gets it                                                     | How it ships                                                           |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `inteligir` on npm | `npx inteligir serve --open`                                    | `pnpm --filter inteligir publish`                                      |
| The Mac app        | the site's Download button, and every installed app's updater   | a GitHub release carrying the dmg, the signed update and `latest.json` |
| The iPhone app     | TestFlight: the internal `Owner` group, then the `Cohort` group | `pnpm testflight:mobile` (EAS Build, submitted to App Store Connect)   |

The three manifests carry one version (`apps/cli`, `apps/desktop`,
`apps/mobile`; `tools/repo-guards/src/release-versions.test.ts` refuses a
split), and a release's notes are `CHANGELOG.md`'s top section
(`tools/repo-guards/src/changelog.test.ts`).

The Worker is not one of them: `.github/workflows/deploy.yml` deploys it after
every green CI on main and moves the `deployed/web` tag to what it deployed.
**The order is the rule**: the D1 schema, then the Worker, then any build that
calls a route the Worker just gained. An app ahead of its Worker fails every
such call; a Worker ahead of its apps costs nothing, because `/v1` never
breaks a stale install.

The owner publishes once, when every step and every check below has passed.

## Once per machine

- **`.release/`** (gitignored) at the repo root: `notary.env` (`APPLE_API_KEY`,
  the `.p8`'s file name, beside it; `APPLE_API_KEY_ID`; `APPLE_API_ISSUER`)
  and the `.p8`, with the Developer ID Application certificate in the login
  keychain (`security find-identity -v -p codesigning` lists it); and the
  updater's key, which signs every update an installed app accepts:
  `pnpm --filter @repo/desktop tauri signer generate -w ../../.release/updater.key`
  (the path is the desktop package's, where the filter runs the script)
  writes `updater.key` and `updater.key.pub`, and the password it asked for
  goes in `updater.key.password`. Lose the key and no installed app can verify
  an update again, so it is backed up wherever the Developer ID's export is.
  `apps/desktop/README.md` § Packaging says how the package step reads them.
- **GitHub and npm**: `gh auth status` has push rights on the repo, and
  `npm whoami` names the account that owns `inteligir`.
- **Cloudflare**: `pnpm --filter @repo/web exec cf auth whoami` is signed in,
  and the root `.env.production.local` holds the three D1 credentials
  `.env.example` names.
- **The phone**: `apps/mobile/README.md` § One-time setup (EAS, the App Store
  Connect record, the `Owner` group) and § Beta App Review account. Passing:
  `easProject` in `apps/mobile/app.config.js` and
  `submit.production.ios.ascAppId` in `apps/mobile/eas.json` are committed, and
  `pnpm --filter @repo/mobile exec eas config --platform ios` shows the bundle
  identifier `com.inteligir.mobile`.

## 1. Version and changelog

On main, clean, at the commit to ship:

1. Set `version` in `apps/cli/package.json`, `apps/desktop/package.json` and
   `apps/mobile/package.json` to the release's `<version>`. The shell reports
   its own version and ships the CLI's tree, each refuses a server of another
   version, and the phone's marketing version is its package's.
2. Retitle `CHANGELOG.md`'s `## Unreleased` as `## <version> — <YYYY-MM-DD>`,
   and read the section once as a user would: it is the GitHub release's body,
   word for word.

## 2. Gates

```sh
pnpm format:fix && pnpm verify && pnpm e2e && pnpm smoke:cli && pnpm smoke:desktop
```

`smoke:desktop` packages the app, signs it, notarizes it with `.release/` and
boots it; quit any running Inteligir first, since the packaged app would hand
over to it. Its output must say `package: notarizing with …` and
`package: signing the update`: a pack that reports `.release/` absent opens
only on the Mac that built it, and one with no updater key ships an app that
never updates. Package only through `pnpm smoke:desktop` or
`pnpm package:desktop`: turbo's strict env mode strips `APPLE_API_*` exported
in a shell (so they live in `.release/`), and the Tauri CLI run directly packs
none of the resources (`apps/desktop/scripts/package.mjs` names them) and
signs none of the binaries inside them.

Commit as `release: <version>`, push, and wait for CI on that commit to go
green: `gh run list --commit "$(git rev-parse HEAD)"`.

## 3. The cloud first

1. **The D1 schema.** `pnpm --filter @repo/web db:push:remote --explain`
   prints the SQL a push would run against production and runs none of it.
   - Nothing planned: go on.
   - Only `CREATE INDEX`, `CREATE TABLE` or `ALTER TABLE … ADD`: run
     `pnpm --filter @repo/web db:push:remote`, then `--explain` again, which
     now plans nothing.
   - Anything that recreates a table (a `__new_` table, a `DROP TABLE`): STOP.
     D1 ignores the foreign-key pragma a recreate leans on, so the drop
     cascades through every session, account and device (`CLAUDE.md` §
     Declare D1 uniques as named unique indexes).

   Deploy never touches the schema, so it belongs in D1 before the code that
   needs it reaches main. A plan found here means main's Worker already runs
   on an older schema: push it now.

2. **The Worker.** Nothing the Worker builds from has changed since what it
   deployed, and the deployed Worker answers the newest routes:

   ```sh
   git fetch origin --tags --force
   gh run list --workflow Deploy --limit 3                  # the run after step 2's CI succeeded
   pnpm turbo ls --filter="@repo/web...[deployed/web]"      # names no package
   curl -s -X POST https://inteligir.com/v1/vault/commit    # an "unauthorized" error, never "not-found"
   ```

   A package named means the Worker at this commit is not deployed yet: wait
   for Deploy, or re-run it from the Actions tab.

## 4. The phone's internal build

`apps/mobile/README.md` § Per release, steps 1 to 3: the pre-flight,
`pnpm testflight:mobile` from the release commit, and the build installed on
the owner's iPhone from the `Owner` group. Nothing reaches the `Cohort` group
yet.

## 5. The owner's checks

Every check here needs a real device, a real account or a credential no CI
holds. Run them on the release's own artifacts: the Mac app
`pnpm smoke:desktop` left at
`apps/desktop/src-tauri/target/release/bundle/macos/Inteligir.app` (signed and
notarized; drag it to `/Applications` and open it from Finder), and the iPhone build from the
`Owner` group, except where a check names the simulator or a development
build. A failing check stops the release: fix it, and start again at step 1.

A change whose proof needs a device, an account or a credential adds its check
here, under its surface, with how to run it and what passing looks like.

The commands below name the pack as `app`:

```sh
app=apps/desktop/src-tauri/target/release/bundle/macos/Inteligir.app
```

### The Mac app

- **Signed and notarized, the bundled node included.**

  ```sh
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign --verify --strict --verbose=2 "$app/Contents/MacOS/node"
  spctl --assess --type execute --verbose=4 "$app"
  xcrun stapler validate "$app"
  ```

  Passing: both `codesign` runs say `valid on disk` and
  `satisfies its Designated Requirement`, `spctl` says `accepted` with
  `source=Notarized Developer ID`, and `stapler` says
  `The validate action worked!`.

- **A connector added outside the app.** With the bundled binary,
  `"$(find "$app" -type f -perm +111 -name claude | head -1)" mcp add --scope user <name> -- <command>`
  for any stdio server. Passing: a new action asked which tools it has lists
  that server's, with nothing set in the app.
- **Dictation is the Mac's.** Press fn twice in the ⌘K composer and speak,
  then type. Passing: the words land once, at the caret; typing carries on
  after them; Enter while dictation is live does not send; the Edit menu shows
  Start Dictation….

### The iPhone app, on the internal build

On the owner's iPhone, installed from TestFlight, never a development build.

- **Sign in** with the account's email and password. Passing: the threads
  show. Kill the app and open it again. Passing: the splash holds until it
  knows, the sign-in form never flashes, and the phone is still signed in.
- **Offline.** Sync once, turn on airplane mode, kill the app and open it.
  Passing: every thread opens. Reply in one while still offline, kill the app,
  open it, turn airplane mode off. Passing: the reply reaches the Mac.
- **Ask your Mac.** Reply in a thread with the Mac app open. Passing: the
  request shows Waiting for your Mac…, then Your Mac has it; the Mac runs it,
  and its reply appears on the phone after a pull; the composer rides above the
  keyboard; a question the agent asks for permission is answered on the phone.
  Quit the Mac app and ask again. Passing: Waiting for your Mac — open
  inteligir on it to run this.
- **A reply grows as the Mac writes it.** With the phone's app in the
  foreground, ask the Mac something that takes a while. Passing: the reply's
  text grows under the running indicator while the Mac writes it, well before
  the 60s poll would land it (the account's socket upgraded from the device,
  React Native's headers argument carrying the bearer), and ends as the
  settled reply.
- **Sign out.** With a request still unsent (airplane mode), Sign out. Passing: it
  asks first and names the count; confirmed, the sign-in screen shows.
- **Revoke.** Sign the phone in again, then Revoke it in Settings › Account on
  the Mac. Passing: the phone's next request ends its sign-in, and the sign-in
  screen says this device was signed out.
- **A new phone signs in as itself.** Restore this iPhone's encrypted backup
  onto another iPhone and open the app. Passing: it shows the sign-in screen,
  and once signed in Settings › Account on the Mac lists it beside the first
  phone.
- **An update reaches an installed build.** While the internal build is the
  only one out, `pnpm hotfix:mobile` from the release commit, then open the app
  twice. Passing: `pnpm --filter @repo/mobile exec eas update:insights <group id>`
  (`eas update:list --branch production` names the group) counts a launch. An
  update that matches no build is the fingerprint trap in § Hotfixes.

### The iPhone app, in the simulator or a development build

- **The database upgrades.** Every step appended to `MIGRATIONS` in
  `apps/mobile/src/lib/phone-db.ts` since the build testers hold: install that
  build (for this release, a development build from the last commit whose
  `MIGRATIONS` held three steps), sign in, sync, leave a request unsent, then
  install this build over it. Passing: it opens with no error, the unsent
  request still waits, and after one sync, turning on airplane mode and a cold
  launch shows the threads.

## 6. Publish

Only once every check has passed, and the three close together: the npm CLI
refuses a server of another version, so npm and the Mac app ship as one.

1. **The Mac app.** Tag and publish. The site's Download button links
   `releases/latest/download/Inteligir-arm64.dmg`, so the release must carry
   the dmg under that fixed name (`DMG_NAME` in
   `apps/desktop/scripts/package.mjs`), and every installed app reads
   `latest.json` and the signed `Inteligir.app.tar.gz` it names. The notes are
   the changelog's top section, which `apps/desktop/scripts/release-notes.mjs`
   prints only once it is titled for this version, so a refusal stops the
   chain before the tag:

   ```sh
   node apps/desktop/scripts/release-notes.mjs > .release/notes.md &&
     git tag v<version> && git push origin v<version> &&
     gh release create v<version> --notes-file .release/notes.md \
       apps/desktop/.output/bin/Inteligir-arm64.dmg \
       apps/desktop/.output/bin/Inteligir.app.tar.gz \
       apps/desktop/.output/bin/Inteligir.app.tar.gz.sig \
       apps/desktop/.output/bin/latest.json \
       apps/desktop/.output/bin/Inteligir-<version>-arm64.zip \
       apps/desktop/.output/bin/latest-mac.yml
   ```

   A release missing `latest.json` or the archive is one no installed app can
   update to, and one missing `Inteligir-arm64.dmg` leaves the Download button
   a 404. The zip and `latest-mac.yml` are for the Electron builds (0.6.0 and
   older), whose updater reads them: the zip holds this app, under the same
   bundle id and team, so they update onto it. The manifest's
   `minimumSystemVersion` is Darwin 22.6.0, which is macOS 13.5, node 24's
   floor, since electron-updater compares Darwin releases: an Electron build
   on an older Mac is offered nothing it cannot open and
   stays on 0.6.0. Keep uploading both until no tester runs an Electron build.

2. **npm.** `pnpm --filter inteligir publish --otp <code>`, from the tagged
   commit on a clean main (pnpm refuses another branch or a dirty tree); it
   packs the `apps/cli/dist` step 2 built. The code rides the flag because a
   shell without a terminal cannot prompt for it, and an `E401` means the
   stored token expired: `npm login`, then again. pnpm rewrites the manifest
   on the way out (`publishConfig.exports`). A version can reach the registry
   many minutes after pnpm says Published (0.6.0 took fourteen): poll
   `npm view inteligir@<version> version`, and never publish again, since a
   second publish of that version is refused.
3. **The phone's cohort.** `apps/mobile/README.md` § Per release, steps 4 to
   6: What to Test, Beta App Review, then the invites.

## 7. After

- **The download.** Passing: the site's Download button downloads this
  version's `Inteligir-arm64.dmg`, and the app from it opens from Finder with
  no warning beyond macOS's downloaded-from-the-internet notice.
- **The update.** On a Mac running the previous release, Settings › About ›
  Check for Updates. Passing: it finds `<version>`, Download and Restart each
  take a click, and the app comes back as `<version>` with the vault as it
  was.
- **npm.** Passing: `npm view inteligir version` and
  `npx -y inteligir@<version> --version` both print `<version>`.
- **The cohort.** Passing: the phone build is approved in the `Cohort` group,
  and one tester installs it from the invite and signs in.
- **This file.** Whatever the release needed that is not written here goes in
  now, where the next release will meet it.

## Hotfixes

- **The phone, JavaScript alone**: an EAS Update, never a new build
  (`apps/mobile/README.md` § Hotfixes has the mechanics). Branch from the tag
  of the build testers hold, apply the fix, and run `pnpm hotfix:mobile` there.
  An update reaches only builds whose fingerprint matches, and the fingerprint
  covers the app config, `version` included, so one bundled after a version
  bump reaches nobody; `pnpm --filter @repo/mobile exec eas fingerprint:compare --build-id <id>`
  names what differs. Passing: as the update
  check in § 5. A bad update is rolled back with
  `pnpm --filter @repo/mobile exec eas update:rollback <group id>`.
- **The phone, anything native** (a module, a config plugin, the SDK): a new build of the same version, `pnpm testflight:mobile` from
  a branch off the tag, then `apps/mobile/README.md` § Per release from step 3.
- **The Mac app or the CLI**: a patch version through this whole runbook. All
  three manifests move with it, but the phone's build may stay behind; its
  JavaScript hotfixes then branch from the tag of the build testers hold.
