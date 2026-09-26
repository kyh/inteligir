# Releasing

THE runbook. One product version ships as three artifacts, and every step here
is the owner's: each needs a credential no agent and no CI run holds (the
Developer ID and the notary key, npm's one-time code, the Apple team behind
EAS, Cloudflare), and the agent environment refuses release operations
outright.

| Artifact           | Who gets it                                                     | How it ships                                                                  |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `inteligir` on npm | `npx inteligir serve --open`                                    | `pnpm --filter inteligir publish`                                             |
| The Mac app        | the site's Download button, and every installed app's updater   | a GitHub release carrying the dmg, the zip, its blockmap and `latest-mac.yml` |
| The iPhone app     | TestFlight: the internal `Owner` group, then the `Cohort` group | `pnpm testflight:mobile` (EAS Build, submitted to App Store Connect)          |

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
  keychain (`security find-identity -v -p codesigning` lists it).
  `apps/desktop/README.md` § Packaging says how the package step reads them.
- **GitHub and npm**: `gh auth status` has push rights on the repo, and
  `npm whoami` names the account that owns `inteligir`.
- **Cloudflare**: `pnpm --filter @repo/web exec wrangler whoami` is signed in,
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
boots it. Its output must say `package: notarizing with …`: a pack that
reports `.release/` absent opens only on the Mac that built it. Package only
through `pnpm smoke:desktop` or `pnpm package:desktop`: turbo's strict env mode
strips `APPLE_API_*` exported in a shell (so they live in `notary.env`), and
electron-builder run directly resolves dependencies npm's way, dropping pnpm's
optional platform packages (`@parcel/watcher-darwin-arm64` among them), which
leaves a watcher that crash-loops under a smoke that still passes.

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
`apps/desktop/.output/bin/mac-arm64/Inteligir.app` (signed and notarized; drag
it to `/Applications` and open it from Finder), and the iPhone build from the
`Owner` group, except where a check names the simulator or a development
build. A failing check stops the release: fix it, and start again at step 1.

A change whose proof needs a device, an account or a credential adds its check
here, under its surface, with how to run it and what passing looks like.

The commands below name the pack as `app`:

```sh
app=apps/desktop/.output/bin/mac-arm64/Inteligir.app
```

### The Mac app

- **Signed and notarized, the bundled git included.**

  ```sh
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign --verify --strict --verbose=2 "$app/Contents/Resources/git/bin/git"
  spctl --assess --type execute --verbose=4 "$app"
  xcrun stapler validate "$app"
  ```

  Passing: both `codesign` runs say `valid on disk` and
  `satisfies its Designated Requirement`, `spctl` says `accepted` with
  `source=Notarized Developer ID`, and `stapler` says
  `The validate action worked!`.

- **Sign in with Claude, for real.** On a Mac user signed out of both agents (a
  spare macOS user keeps your own sign-ins), open the app from Finder and
  choose Sign in with Claude, in `/welcome`'s agent step or Settings › Agents.
  Passing: the browser opens Claude's sign-in, and once you approve, the app
  finishes on its own (Paste the code is only the fallback); the card turns
  signed in without a reload; and the bundled binary agrees:
  `"$(find "$app" -type f -perm +111 -name claude | head -1)" auth status`
  reports signed in. Then sign out, start Sign in with Claude again and press
  Cancel mid-way: the card goes back to signed out, and the attempt after it
  completes.
- **Sign in with ChatGPT**, under Other, the same way. Passing: as above, and
  `"$(find "$app" -type f -perm +111 -name codex -path '*/bin/*' | head -1)" login status`
  says logged in.
- **A connector through the browser.** With a real Linear account, Settings ›
  Connectors › Linear while Claude is the default agent. Passing: the browser
  asks Linear to approve, the row turns connected, and a new action asked to
  list your Linear issues calls a Linear tool and lists them. Make ChatGPT the
  default in Settings › Agents and repeat: the same.
- **A connector added outside the app.** With the bundled binary,
  `"$(find "$app" -type f -perm +111 -name claude | head -1)" mcp add --scope user <name> -- <command>`
  for any stdio server. Passing: Settings › Connectors lists it, and a new
  action asked which tools it has lists that server's, with nothing set in the
  app.
- **Dictation is the Mac's.** Press fn twice in the ⌘K composer and speak,
  then type. Passing: the words land once, at the caret; typing carries on
  after them; Enter while dictation is live does not send; the Edit menu shows
  Start Dictation…; and dictating into a note behaves the same.

### The iPhone app, on the internal build

On the owner's iPhone, installed from TestFlight, never a development build. An
account whose vault holds about 2,000 notes gives the timing check its load.

- **Sign in** with the account's email and password. Passing: the first
  mirror says Loading your vault… with its count, then the notes list and the
  threads show. Kill the app and open it again. Passing: the splash holds
  until it knows, the sign-in form never flashes, and the phone is still
  signed in.
- **Edit.** Open a note, type, go back. Passing: typing, autocorrect and the
  keyboard's microphone each land once; the selection handles and the edit
  menu work, with no floating toolbar; the formatting toolbar rides the
  keyboard; and the edit shows in the note on the Mac after its next sync.
  Background the phone's app, change a note on the Mac, come back. Passing:
  the change shows.
- **The editor's edges.** Passing: a cold open of a note is editable within a
  second; New note opens with its title focused and the keyboard up; a
  `[[link]]` pushes its note and back returns; an external link opens Safari
  and the page never navigates; a chart and tabs refuse edits; dark mode
  follows the system; typing and then backgrounding and killing the app keeps
  what was typed.
- **Offline.** Sync once, turn on airplane mode, kill the app and open it.
  Passing: the notes list, any note and every thread open. Edit a note and add
  a photo while still offline, kill the app, open it, turn airplane mode off.
  Passing: both reach the Mac.
- **Both devices at once.** With the phone offline, change the same lines of
  one note on the phone and on the Mac, then reconnect; repeat with different
  lines. Passing: different lines merge; the same lines leave a copy named for
  the device it came from, such as `Plan (conflict, <device>).md`, and the
  phone's banner says how it settled, with Open.
- **Create, rename, delete.** New note; rename a note another note links to;
  delete a note with comments. Passing: the Mac shows the new note, the link
  rewritten to the new name, and Deleted on the Mac brings the note back with
  its comments.
- **Photos.** Add one from the camera and one from the library. Passing: each
  lands in the vault as `assets/<name>.jpg` of about 1 MB or less, draws in
  its note on the Mac, and has no location: Preview's Inspector (⌘I) shows no
  GPS tab.
- **Ask your Mac.** Ask agent from a note with the Mac app open. Passing: the
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
- **Capture.** Passing: a quick capture lands in `Inbox.md` on the Mac.
- **Sign out.** With an edit still unsent (airplane mode), Sign out. Passing: it
  asks first and names the count; confirmed, the sign-in screen shows.
- **Revoke.** Sign the phone in again, then Revoke it in Settings › Account on
  the Mac. Passing: the phone's next request ends its sign-in, and the sign-in
  screen says this device was signed out.
- **No iCloud backup of the notes.** Settings › your name › iCloud › Manage
  Account Storage › Backups › this iPhone. Passing: Inteligir's backup is a
  small fraction of the notes it holds (the mirror downloads again from the
  hosted vault).
- **An update reaches an installed build.** While the internal build is the
  only one out, `pnpm hotfix:mobile` from the release commit, then open the app
  twice. Passing: `pnpm --filter @repo/mobile exec eas update:insights <group id>`
  (`eas update:list --branch production` names the group) counts a launch. An
  update that matches no build is the fingerprint trap in § Hotfixes.

### The iPhone app, in the simulator or a development build

- **The editor page's policy under WebKit.** In a development build
  (`pnpm --filter @repo/mobile ios`), open a note, then Safari › Develop ›
  Simulator › the note's page. Passing: the note is editable, and the console
  has no `Refused to` line; the static CSP is otherwise proven in Chromium
  alone.
- **A killed page reloads.** In the simulator, quit the note's
  `com.apple.WebKit.WebContent` process in Activity Monitor. Passing: the note
  reloads with its text.
- **The database upgrades.** Every step appended to `MIGRATIONS` in
  `apps/mobile/src/lib/phone-db.ts` since the build testers hold: install that
  build (for this release, a development build from the last commit whose
  `MIGRATIONS` held three steps), sign in, sync, leave an edit unsent, then
  install this build over it. Passing: it opens with no error, the unsent edit
  still waits, and after one sync, turning on airplane mode and a cold launch
  shows the threads.

## 6. Publish

Only once every check has passed, and the three close together: the npm CLI
refuses a server of another version, so npm and the Mac app ship as one.

1. **The Mac app.** Tag and publish. The site's Download button reads the
   latest release's `.dmg` (`apps/web/src/lib/download-url.ts`, cached up to an
   hour), and every installed app reads its `latest-mac.yml` and zip. The
   notes are the changelog's top section, which
   `apps/desktop/scripts/release-notes.mjs` prints only once it is titled for
   this version, so a refusal stops the chain before the tag:

   ```sh
   node apps/desktop/scripts/release-notes.mjs > .release/notes.md &&
     git tag v<version> && git push origin v<version> &&
     gh release create v<version> --notes-file .release/notes.md \
       apps/desktop/.output/bin/Inteligir-<version>-arm64.dmg \
       apps/desktop/.output/bin/Inteligir-<version>-arm64.zip \
       apps/desktop/.output/bin/Inteligir-<version>-arm64.zip.blockmap \
       apps/desktop/.output/bin/latest-mac.yml
   ```

   A release missing the zip or the manifest is one no installed app can
   update to.

2. **npm.** `pnpm --filter inteligir publish --otp <code>`, from the tagged
   commit on a clean main (pnpm refuses another branch or a dirty tree); it
   packs the `apps/cli/dist` step 2 built. The code rides the flag because a
   shell without a terminal cannot prompt for it, and an `E401` means the
   stored token expired: `npm login`, then again. pnpm rewrites the manifest
   on the way out (`publishConfig.exports`).
3. **The phone's cohort.** `apps/mobile/README.md` § Per release, steps 4 to
   6: What to Test, Beta App Review, then the invites.

## 7. After

- **The download.** Passing: within the hour the site's Download button serves
  `Inteligir-<version>-arm64.dmg`, and the app from it opens from Finder with
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
  names what differs. The editor page is part of the fingerprint too, so a
  mismatch that names `apps/mobile-editor/dist` with no page change means the
  page's build is not byte-identical across machines. Passing: as the update
  check in § 5. A bad update is rolled back with
  `pnpm --filter @repo/mobile exec eas update:rollback <group id>`.
- **The phone, anything native** (a module, a config plugin, the SDK, the
  editor page): a new build of the same version, `pnpm testflight:mobile` from
  a branch off the tag, then `apps/mobile/README.md` § Per release from step 3.
- **The Mac app or the CLI**: a patch version through this whole runbook. All
  three manifests move with it, but the phone's build may stay behind; its
  JavaScript hotfixes then branch from the tag of the build testers hold.
