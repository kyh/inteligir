# Releasing

THE runbook. One product version ships as three artifacts, and every step here
is the owner's: each needs a credential no agent and no CI run holds (the
Developer ID and the notary key, the Apple team behind
EAS, Cloudflare), and the agent environment refuses release operations
outright.

| Artifact       | Who gets it                                                     | How it ships                                                           |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| The Mac app    | the site's Download button, and every installed app's updater   | a GitHub release carrying the dmg, the signed update and `latest.json` |
| The iPhone app | TestFlight: the internal `Owner` group, then the `Cohort` group | `pnpm testflight:mobile` (EAS Build, submitted to App Store Connect)   |
| The extension  | the Chrome Web Store, for Chrome, Arc, Brave, Edge and Vivaldi  | `pnpm package:extension`, uploaded to the store item                   |

The three manifests carry one version (`apps/desktop`, `apps/extension`,
`apps/mobile`, set in § 1), since the extension calls `/v1` as the apps do and
one client build floor holds them all, and a release's notes are
`CHANGELOG.md`'s top section, which `apps/desktop/scripts/release-notes.ts`
refuses to print until it is titled for that version.

The Worker is not one of them: `.github/workflows/deploy.yml` deploys it after
every green CI on main and moves the `deployed/web` tag to what it deployed.
**The order is the rule**: the D1 schema, then the Worker, then any build that
calls a route the Worker just gained. An app ahead of its Worker fails every
such call; a Worker ahead of its apps costs nothing, because `/v1` breaks a
build only once `MIN_CLIENT_BUILD` (`apps/web/cloudflare.config.ts`) is raised
past it, which retires a wire shape on purpose and is never part of a release
by default.

**The first outside tester ends the no-users premise** (`AGENTS.md` § Project
Overview). Before anyone outside the team gets a build, through the `Cohort`
group or an invite code, strike that premise from `AGENTS.md`:
from that build on, a format change migrates.

The owner publishes once, when every step up to § 6 and every check in § 5 has
passed; § 7's checks need the published release.

## Once per machine

- **`.release/`** (gitignored) at the repo root: `notary.env` and the `.p8`
  beside it, with the Developer ID Application certificate in the login
  keychain (`security find-identity -v -p codesigning` lists it); and the
  updater's key, which signs every update an installed app accepts:
  `pnpm --filter @repo/desktop tauri signer generate -w ../../.release/updater.key`
  (the path is the desktop package's, where the filter runs the script)
  writes `updater.key` and `updater.key.pub`, and the password it asked for
  goes in `updater.key.password`. Lose the key and no installed app can verify
  an update again, so it is backed up wherever the Developer ID's export is.
  `apps/desktop/README.md` § Packaging says how the package step reads them.
  `notary.env` holds Tauri's own names, `APPLE_API_ISSUER`, `APPLE_API_KEY`
  (the key's id) and `APPLE_API_KEY_PATH` (the `.p8`'s file name), and a pack
  refuses one missing any.
- **GitHub**: `gh auth status` has push rights on the repo.
- **Cloudflare**: `pnpm --filter @repo/web exec cf auth whoami` is signed in,
  and the root `.env.production.local` holds the three D1 credentials
  `.env.example` names.
- **The phone**: `apps/mobile/README.md` § One-time setup (EAS, the App Store
  Connect record, the `Owner` group) and § Beta App Review account. Passing:
  `easProject` in `apps/mobile/app.config.js` and
  `submit.production.ios.ascAppId` in `apps/mobile/eas.json` are committed, and
  `pnpm --filter @repo/mobile exec eas config --platform ios` shows the bundle
  identifier `com.inteligir.mobile`.

## Once per product: the extension's store item

The committed extension key (`EXTENSION_PUBLIC_KEY` in
`packages/contract/src/extension/extension-identity.ts`) is one this repo
generated and threw the private half of away, so the dev build and the unpacked
store build have a stable id before any listing. The Web Store signs the real
item with a key of its own, and the id the cloud's sign-in trusts and the site's
connect page messages must be that item's. Once:

1. A Chrome Web Store developer account (the one-time registration fee) on the
   owner's Google account.
2. `pnpm package:extension`, then upload
   `apps/extension/.output/inteligir-extension-<version>.zip` as a new item and
   save it as a draft, unpublished.
3. In the draft's Package tab, View public key: paste the key's base64 body
   into `EXTENSION_PUBLIC_KEY`. `pnpm --filter @repo/contract test` then fails
   naming the id Chrome derives from it; set `EXTENSION_ID` to that, which is
   the draft's id on its dashboard too.
4. Commit both. Every later upload is § 6's.

## 1. Version and changelog

On main, clean, at the commit to ship:

1. Set `version` in `apps/desktop/package.json`, `apps/extension/package.json`
   and `apps/mobile/package.json` to the release's `<version>`. The shell
   reports its own version, the phone's marketing version is its package's,
   and each app names it in every call.
2. Retitle `CHANGELOG.md`'s `## Unreleased` as `## <version> — <YYYY-MM-DD>`,
   and read the section once as a user would: it is the GitHub release's body,
   word for word.
3. When the comment on `MIN_CLIENT_BUILD` (`apps/web/cloudflare.config.ts`)
   says the next release owes the floor, set it to `<version>` and drop that
   line. Every checkout since the last release reports the last release's
   version, so a change that drops a `/v1` shape an older build reads cannot
   raise the floor past those checkouts: it writes that line instead.
4. Every release uploads the extension (§ 6), whether or not it changed: the
   floor names the product's version, so a store build left a release behind
   is refused the day the floor passes it.

## 2. Gates

```sh
pnpm format:fix && pnpm verify && pnpm e2e && pnpm package:desktop && pnpm package:extension
```

`package:desktop` packages the app, signs it and notarizes it with `.release/`.
Its output must say `package: notarizing with …` and
`package: signing the update`: a pack that reports `.release/` absent opens
only on the Mac that built it, and one with no updater key ships an app that
never updates. Package only through `pnpm package:desktop`: turbo's strict env
mode strips `APPLE_API_*` exported in a shell (so they live in `.release/`),
and the Tauri CLI run directly packs no licence notices and writes no update
feed (`apps/desktop/scripts/package.ts` sets both).

Commit as `release: <version>`, push, and wait for CI on that commit to go
green: `gh run list --commit "$(git rev-parse HEAD)"`.

## 3. The cloud first

1. **The D1 schema.** `pnpm --filter @repo/db push:remote --explain`
   prints the SQL a push would run against production and runs none of it.
   - Nothing planned: go on.
   - Only `CREATE INDEX`, `CREATE TABLE` or `ALTER TABLE … ADD`: run
     `pnpm --filter @repo/db push:remote`, then `--explain` again, which
     now plans nothing.
   - A `DROP INDEX` or an `ALTER TABLE … DROP COLUMN` of a column Better Auth
     does not write (such as `account.issuer`, with its index): push it as
     Deploy finishes, since a sign-up fails while one side has it and the
     other does not, then `--explain` again.
   - `DROP TABLE device` alone, once, in the release that ends the device
     credential: the table is a child of `user` that nothing references, so the
     drop cascades nothing. Push it as Deploy finishes, since the Worker before
     it reads the table, then `--explain` again. drizzle-kit refuses a drop of a
     table that holds rows until `--hints` confirms the loss, and its refusal
     prints the hint to pass (`confirm_data_loss` for `device`).
   - Anything else that recreates a table (a `__new_` table, a `DROP TABLE`):
     STOP. D1 ignores the foreign-key pragma a recreate leans on, so the drop
     cascades through every session and account (`packages/db/CLAUDE.md`,
     Declare D1 uniques as named unique indexes).

   Deploy never touches the schema, so it belongs in D1 before the code that
   needs it reaches main. A plan found here means main's Worker already runs
   on an older schema: push it now. D1's `revoked_grant` table goes in before
   the Worker deploys, since every connector call reads it and fails without
   it.

2. **The Worker.** Nothing the Worker builds from has changed since what it
   deployed, and the deployed Worker answers the newest routes:

   ```sh
   git fetch origin --tags --force
   gh run list --workflow Deploy --limit 3                  # the run after step 2's CI succeeded
   pnpm turbo query affected --packages @repo/web --base deployed/web --head HEAD   # names no package
   curl -s -X POST -H 'content-type: application/json' -H 'x-inteligir-build: <version>+mobile' \
     --data '{}' https://inteligir.com/v1/rpc/account/devices/list   # a 401 UNAUTHORIZED, never a 404
   ```

   The query is the one Deploy asks. A package named means the Worker at this
   commit is not deployed yet: wait for Deploy, or re-run it from the Actions
   tab.

3. **The fill queues.** `pnpm --filter @repo/web exec cf queues list` names
   `inteligir-fill` and `inteligir-fill-failed`; a deploy that binds them
   refuses without them (`apps/web/README.md` § Build & deploy, step 6b), and
   Deploy's token holds Queues: Edit.

4. **The connector's OAuth namespace.** `pnpm --filter @repo/web exec cf kv
   namespaces list` names the namespace the first deploy created for
   `OAUTH_KV` (it declares no id, `apps/web/README.md` § Build & deploy, step
   6c), and Deploy's token holds Workers KV Storage: Edit. The production
   Worker's metadata names its own origin:
   `curl -s https://inteligir.com/.well-known/oauth-authorization-server`
   answers `"issuer":"https://inteligir.com"`.

## 4. The phone's internal build

`apps/mobile/README.md` § Per release, steps 1 to 3: the pre-flight,
`pnpm testflight:mobile` from the release commit, and the build installed on
the owner's iPhone from the `Owner` group. Nothing reaches the `Cohort` group
yet.

§ 3's Worker comes before this build: every save's answer carries `created`,
which an older Worker doesn't send. This build drops the phone's local Expo
module for the HTTP cache, and the config plugin and the fingerprint rules that
carried the old editor page, native changes that move the fingerprint, so it
ships as a new EAS build, never an EAS Update (§ Hotfixes).

## 5. The owner's checks

One smoke list per surface, each check needing what no agent can run: a
device, signing, a store, a real model turn, a Cloudflare dashboard, or
claude.ai and ChatGPT. Run them on the release's own artifacts: the Mac app
`pnpm package:desktop` left at
`apps/desktop/src-tauri/target/release/bundle/macos/Inteligir.app` (dragged to
`/Applications` and opened from Finder), the extension `pnpm package:extension`
left at `apps/extension/.output/chrome-mv3-store-unpacked`, and the iPhone build
from the `Owner` group. A failing check stops the release: fix it, and start
again at step 1.

### The cloud's resources

In the Cloudflare dashboard of the account `CLOUDFLARE_ACCOUNT_ID` names;
production and the previews share nothing.

- **Secrets and bindings**: the Worker holds only `BETTER_AUTH_SECRET` and
  `AI_GATEWAY_TOKEN` as secrets, the OAuth KV namespace is the target's, and a
  preview binds only preview resources (`apps/web/README.md` § Previews).
- **The fill queues** on production: `inteligir-fill` consumed with
  `inteligir-fill-failed` as its dead-letter queue, and a link a connected
  assistant saves is read.
- **Imports on a preview**: a Raindrop CSV, an Obsidian zip and a 3 MB row
  land, and a `PUT /v1/blobs/<sha>` of bytes hashing to another sha answers 400.
- **A PR preview's lifecycle**: closing a PR with a preview deletes it, closing
  one without takes Cloudflare's 10025 as nothing to do, and a stranger's
  `<!-- worker-previews -->` comment is ignored.

### The Mac app

On the signed pack, against production, from a spare macOS user.

```sh
app=apps/desktop/src-tauri/target/release/bundle/macos/Inteligir.app
codesign --verify --deep --strict --verbose=2 "$app" && codesign -d --entitlements - "$app"
spctl --assess --type execute --verbose=4 "$app" && xcrun stapler validate "$app"
```

- **Signed .app from Finder**: codesign, spctl and stapler pass, it carries no
  entitlement and bundles its notices, and it opens on macOS 13.5 and the
  newest macOS.
- **First run on a fresh macOS user**: the site's sign-in in the window, an
  invite sign-up, still signed in after Quit; a dev build keeps a store of its
  own; This Mac shows in Settings › Account.
- **Update**: a build one behind offers Download, then Restart opens the new
  version.
- **Window**: the system title bar, close hides it, offline it says so, and
  View › Reload recovers.
- **Dictation**: fn fn in a note lands the words once.
- **Paste and drop** from Safari, Chrome, Arc and Finder: a link, a screenshot,
  a PDF and a file; over 100 MB refused; picture, PDF, mp4, mov and m4a items
  play in WebKit; Download lands in Downloads.
- **Scale**: a 300-block article and a library of 20,000 to 50,000 items stay
  smooth; VoiceOver reads the grid and ⌘P.

### The browser extension

The unpacked store build, against production, with no dev build loaded.

- **The store build** loads in Chrome, Arc, Brave and Edge with the id
  `EXTENSION_ID` (`packages/contract/src/extension/extension-identity.ts`), and
  the Web Store listing and the site's Save link open it.
- **Sign in** through the welcome tab and `/connect/extension`; the browser
  shows in Settings › Account.
- **Save**: the toolbar saves, a second save says already saved, right-click
  saves a link and an image, the badge shows ! and ✓, and a home-network page
  the cloud can't reach saves as the extension read it.
- **A waiting save**: one made offline, across a browser restart, or signed out
  lands later with no click.

### The iPhone app, on the internal build

- **The build**: the first `pnpm testflight:mobile` registers the App Group and
  the share extension, this build installs over the last, and an EAS update
  reaches the installed build.
- **Sign-in**: Sign in and Create an account; still signed in after a week, a
  lock and a restart (Keychain); Safari's sign-in stays Safari's; no iCloud
  backup growth; a restored backup on another phone signs in as itself.
- **The editor on real WebKit**: typing, autocorrect, the keyboard's mic, the
  `[[` picker, a 20,000-word paste, and the Embed dialog covering the screen on
  iOS 26.
- **The editor's edges** on the oldest supported iPhone and on iOS 16.4: a cold
  open under a second, Inter and KaTeX faces, no zoom, the caret above the
  keyboard, Mermaid in dark mode.
- **Live**: phone and Mac typing in one note at once, a Mac edit arriving at
  once, a reconnect after a lock or airplane mode, and Leave without saving
  with unsent typing.
- **An offline launch**: items read-only, Needs a connection, and "1 save
  waiting", which lands once back online.
- **Shares** from Safari, YouTube, Mail, X and Notes (text, Japanese, a bit.ly
  link, `https://en.wikipedia.org/wiki/Oklahoma!`); a duplicate share opens the
  item; Page not read says why.
- **Photos** from the camera and the library at 1 MB or less with no GPS, a
  picture pasted in a note, and pictures, video and PDFs read across devices.
- **Hostile images**: a 30000 x 30000 PNG, an AVIF or HEIC over 50 megapixels,
  a 48-megapixel JPEG and a hostile `og:image` cover each draw or refuse with no
  crash.
- **The agent on the phone**: approvals, Stop beside a question, thinking shown,
  and an offline send refused.
- **Sign-out**: with a share waiting, a revoke in the foreground and the
  background, and mid-upload; the app's Library/Caches holds nothing after.

### The iPhone app, in the simulator or a development build

- **A release build in the simulator**: the editor's content policy under
  WebKit, the `+native-intent` share address, a killed WebContent process
  reloading, and every screen in light and dark.

### The site

- **A password reset** mailed on production signs every device out, and a
  reset or sign-up started from the consent page lands back there.
- **Share cards** for /about and /privacy in a chat app; `apps/web/public/og.jpg`
  and the store listing's pitch are current.

### The library in a browser tab

- **The production deploy**: `/library` with no policy error, a `?item=` deep
  link, its assets and a 404; the account socket's 101 and ping/pong; a new cell
  schema migrates; and the output says which deleted class may leave the
  `exports` map in `apps/web/cloudflare.config.ts`.
- **Safari, Chrome and Firefox**: live edits, the offline notice, the leave
  prompt with unsent typing, popups fading, ⌘P, VoiceOver, a Docs or Word list
  paste, and a tab left open keeping its sign-in.
- **Safari on an iPhone with iOS 26**: a dialog's backdrop covers the screen,
  Page not read opens its popover on a tap, and the header fits a phone.

### The connector

On a preview's `/connector` and on production's, signed in to an account there.

- **claude.ai**: add the custom connector, consent, read, edit, Disconnect; a
  sign-up from the consent page returns to it.
- **Claude Code**: `claude mcp add`, the consent page's warning, 9 tools, and
  `read_item` answering inline.
- **ChatGPT**: a developer-mode connector, consent, and the four reading tools
  alone under read-only.

### The built-in agent

Each target has its own AI Gateway and Anthropic workspace. An account has two
turns a UTC day (`AGENT_ALLOWANCE` in `packages/service/agent-limits.ts`).

- **Gateways**: each target's holds its own key, with Authenticated Gateway on,
  no payload logs and a per-account spend limit; each Anthropic workspace is
  separate and capped; the Deploy run names production's gateway.
- **A real turn on a preview**, open in a tab and the Mac at once: events
  stream, one change set, Undo keeps your typing, the allowance counts, and
  cache reads show.
- **Budgets**: a deploy mid-turn costs one call, a turn stops at 20 steps, and a
  spent per-account limit ends it as unreachable.
- **Real-model behaviour**: a declined turn finishes on the fallback; approvals
  allow, deny and time out; Tidy my library follows the rules; the agent writes
  the dialect.
- **Across deploys**: a prompt change between two turns is taken up, and a long
  conversation compacts and goes on after a pause and a deploy.
- **A link the agent saves from a hostile page** waits for the seal
  (production).

## 6. Publish

Only once every check in § 5 has passed, and the three close together.

1. **The Mac app.** Tag and publish. The site's Download button links
   `releases/latest/download/Inteligir-arm64.dmg`, so the release must carry
   the dmg under that fixed name (`DMG_NAME` in
   `apps/desktop/scripts/package.ts`), and every installed app reads
   `latest.json` and the signed `Inteligir.app.tar.gz` it names. The notes are
   the changelog's top section, which `apps/desktop/scripts/release-notes.ts`
   prints only once it is titled for this version, so a refusal stops the
   chain before the tag:

   ```sh
   node apps/desktop/scripts/release-notes.ts > .release/notes.md &&
     git tag v<version> && git push origin v<version> &&
     gh release create v<version> --notes-file .release/notes.md \
       apps/desktop/.output/bin/Inteligir-arm64.dmg \
       apps/desktop/.output/bin/Inteligir.app.tar.gz \
       apps/desktop/.output/bin/Inteligir.app.tar.gz.sig \
       apps/desktop/.output/bin/latest.json
   ```

   A release missing `latest.json` or the archive is one no installed app can
   update to, and one missing `Inteligir-arm64.dmg` leaves the Download button
   a 404.

2. **The phone's cohort.** `apps/mobile/README.md` § Per release, steps 4 to
   6: What to Test, Beta App Review, then the invites.
3. **The extension.** Upload
   `apps/extension/.output/inteligir-extension-<version>.zip` to the store
   item, and keep the listing true to what it does: the description, the
   screenshots, the single-purpose statement ("saves the page you are on to
   your Inteligir library"), a justification for each permission (`activeTab`
   and `scripting` to read the page only when you click, `contextMenus` for the
   right-click Save, `cookies` and the `https://inteligir.com/*` host to read
   your inteligir.com sign-in, so the extension saves as you with no sign-in of
   its own, `storage` to keep which account it saves to and a save made
   offline or signed out, `alarms` to send that save once you're back online
   or signed in), the privacy practices
   (website content and authentication information, sent to the person's own
   Inteligir library, never sold or transferred) and the policy URL
   `https://inteligir.com/privacy`. Submit for review; § 7 installs what the
   store approves.

## 7. After

- **The download.** Passing: the site's Download button downloads this
  version's `Inteligir-arm64.dmg`, and the app from it opens from Finder with
  no warning beyond macOS's downloaded-from-the-internet notice.
- **The update.** It starts from the previous release reading the `latest.json`
  § 6 published, so it runs only here. The first build that carries this
  updater has no build before it that reads `latest.json`, since 0.6.0 reads
  another feed and its people download this one, so that release skips this,
  and the next starts from that build. On a Mac running the previous release,
  open the app and wait a minute, or choose Settings › About › Check for
  updates. Passing: it finds `<version>` and downloads it by itself,
  Settings › About says it installs when you quit, and the app menu offers
  Restart to Update; Quit and reopen, and About Inteligir names `<version>`,
  with the library as it was. Again from the previous build, type in an item
  and choose Restart to Update from the app menu at once. Passing: the app
  relaunches at once as `<version>`, with the words just typed still in the
  item.
- **The extension.** Once the store approves this upload, install it from
  `chromewebstore.google.com/detail/<EXTENSION_ID>` in a browser with no dev
  build loaded. Passing: the install prompt names inteligir.com as the one
  site it can read and change, chrome://extensions shows `EXTENSION_ID`, and,
  signed in to inteligir.com in that browser, the toolbar button saves the page
  into the library with no other step.
- **The cohort.** Passing: the phone build is approved in the `Cohort` group,
  and one tester installs it from the invite and signs in.
- **This file.** Whatever the release needed that is not written here goes in
  now, where the next release will meet it.

## Hotfixes

- **The phone, JavaScript alone**: an EAS Update, never a new build
  (`apps/mobile/README.md` § Hotfixes has the mechanics). Branch from the tag
  of the build TestFlight serves, apply the fix, and run `pnpm hotfix:mobile`
  there. An update reaches only builds whose fingerprint matches, and the fingerprint
  covers the app config, `version` included, so one bundled after a version
  bump reaches nobody; `pnpm --filter @repo/mobile exec eas fingerprint:compare --build-id <id>`
  names what differs. The editor rides the JavaScript, so its fixes are
  updates too. Passing: as the update check in § 5. A bad update is rolled back with
  `pnpm --filter @repo/mobile exec eas update:rollback <group id>`.
- **The phone, anything native** (a module, a config plugin, the SDK): a new
  build of the same version, `pnpm testflight:mobile` from
  a branch off the tag, then `apps/mobile/README.md` § Per release from step 3.
- **The Mac app or the extension**: a patch version through this whole runbook. All
  three manifests move with it, but the phone's build may stay behind; its
  JavaScript hotfixes then branch from the tag of the build TestFlight serves.
