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
`apps/mobile`; `tools/repo-guards/src/release-versions.test.ts`
refuses a split), since the extension calls `/v1` as the apps do and one client
build floor holds them all, and a release's notes are `CHANGELOG.md`'s top
section (`tools/repo-guards/src/changelog.test.ts`).

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
`packages/contract/src/cloud/extension/extension-identity.ts`) is one this repo
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
pnpm format:fix && pnpm verify && pnpm e2e && pnpm smoke:desktop && pnpm package:extension
```

`smoke:desktop` packages the app, signs it, notarizes it with `.release/`,
boots a Worker on this machine and opens the app on it, never production. Its
output must say `package: notarizing with …` and
`package: signing the update`: a pack that reports `.release/` absent opens
only on the Mac that built it, and one with no updater key ships an app that
never updates. Package only through `pnpm smoke:desktop` or
`pnpm package:desktop`: turbo's strict env mode strips `APPLE_API_*` exported
in a shell (so they live in `.release/`), and the Tauri CLI run directly packs
no licence notices and writes no update feed (`apps/desktop/scripts/package.ts`
sets both).

Commit as `release: <version>`, push, and wait for CI on that commit to go
green: `gh run list --commit "$(git rev-parse HEAD)"`.

## 3. The cloud first

1. **The D1 schema.** `pnpm --filter @repo/web db:push:remote --explain`
   prints the SQL a push would run against production and runs none of it.
   - Nothing planned: go on.
   - Only `CREATE INDEX`, `CREATE TABLE` or `ALTER TABLE … ADD`: run
     `pnpm --filter @repo/web db:push:remote`, then `--explain` again, which
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
     cascades through every session and account (`apps/web/CLAUDE.md`,
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
module for the HTTP cache, a native change that moves the fingerprint, so it
ships as a new EAS build, never an EAS Update (§ Hotfixes).

## 5. The owner's checks

Every check here needs a real device, a real account or a credential no CI
holds. Run them on the release's own artifacts: the Mac app
`pnpm smoke:desktop` left at
`apps/desktop/src-tauri/target/release/bundle/macos/Inteligir.app` (signed and
notarized; drag it to `/Applications` and open it from Finder), the extension
`pnpm package:extension` left at
`apps/extension/.output/chrome-mv3-store-unpacked`, and the iPhone build from
the `Owner` group, except where a check names the simulator
or a development build. A failing check stops the release: fix it, and start again at step 1.

A change whose proof needs a device, an account or a credential adds its check
here, under its surface, with how to run it and what passing looks like.

The commands below name the pack as `app`:

```sh
app=apps/desktop/src-tauri/target/release/bundle/macos/Inteligir.app
```

### The cloud's resources

Each target's own, in the Cloudflare dashboard of the account
`CLOUDFLARE_ACCOUNT_ID` names; nothing here is shared by production and the
previews.

- **Every secret is set, and the Worker holds only its two.** Workers ›
  `inteligir-web` › Settings lists `BETTER_AUTH_SECRET` and `AI_GATEWAY_TOKEN`
  as secrets and nothing else secret (the two `bindings.secret()` rows of
  `apps/web/cloudflare.config.ts`), production's own values; the previews'
  base config holds two values of their own (`apps/web/README.md`
  § Previews); and the repository's Actions secrets hold
  `CLOUDFLARE_API_TOKEN`, with the scopes `apps/web/README.md` § Build &
  deploy names and the two § Previews adds, and `CLOUDFLARE_ACCOUNT_ID`. Passing: a sign-in on
  inteligir.com and one on a preview each keep their session across a
  reload, and the built-in agent's gateway checks below pass on both.
- **The connector's OAuth namespace is the target's.** Workers KV lists the
  namespace production's first deploy made for `OAUTH_KV` and
  `inteligir-oauth-preview`, and nothing else binds either. Passing: an
  assistant connected on a preview is not among production's
  `account.assistants.list`, and its token is refused at
  `https://inteligir.com/connector`.
- **The fill queue and its dead-letter queue.** Queues lists
  `inteligir-fill`, consumed by `inteligir-web` with three retries and
  `inteligir-fill-failed` as its dead-letter queue, `inteligir-fill-failed`,
  consumed by `inteligir-web` too, and `inteligir-fill-preview`, consumed by
  nothing. Passing: a link saved on production whose host answers 500 ends
  `failed` with its reason within about five minutes, and
  `inteligir-fill-failed` holds nothing after it.
- **A preview binds only preview resources.** On the PR's preview: an
  account made there cannot sign in on inteligir.com, a file uploaded there
  is not in `inteligir-vault`, and a link saved there stays unread, since
  nothing consumes `inteligir-fill-preview` (`apps/web/README.md`
  § Previews). Passing: each holds.
- **Closing a PR that has a live preview.** Close it. Passing: the Preview
  workflow's cleanup job is green, the preview's URL stops answering, the
  sticky comment says Deleted, and View deployment is gone from the PR.
- **Closing a PR that never had a preview.** Close one that never went green.
  Passing: the cleanup job is green, having taken Cloudflare's "Preview not
  found" (code 10025) as nothing to do. A red job here means that answer
  changed.
- **A stranger's marker comment.** On a PR whose first report has not run, have
  a second account comment a line starting `<!-- worker-previews -->`, then let
  CI go green. Passing: the preview deploys, and `github-actions[bot]` posts its
  own sticky comment, leaving the stranger's untouched.

### The Mac app

Each on the signed pack, opened from Finder, against production, signed in to
the owner's account; a spare macOS user keeps your own WebKit store out of it.

- **Signed and notarized, with nothing else to run and no entitlement.**

  ```sh
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign -d --entitlements - "$app"
  spctl --assess --type execute --verbose=4 "$app"
  xcrun stapler validate "$app"
  ```

  Passing: `codesign` says `valid on disk` and
  `satisfies its Designated Requirement`, the entitlements print none (no
  `allow-jit`, no `allow-unsigned-executable-memory`, no `network.client`),
  `spctl` says `accepted` with `source=Notarized Developer ID`, and `stapler`
  says `The validate action worked!`. `pnpm smoke:desktop` on a Mac opens the
  same pack on a local Worker's `/library` and quits it; it must pass on macOS 13.5, the oldest
  the pack allows, as on the newest.

- **The first run is the site's sign-in in the window.** Open the app on a Mac
  user that never ran it. Passing: the window opens on the site's sign-in;
  signing in shows the account's library; and Quit and reopen goes straight to
  it. Create an account with an invite code the same way, on a second spare
  user: the same.
- **This Mac in Settings › Account.** Signed in on the Mac and in a browser.
  Passing: Settings › Account lists both, the Mac's window as This device
  (named from its user agent, Mac app) with no Sign out on its row; Sign out
  at the bottom returns the window to the site's sign-in, and the browser stays
  signed in.
- **A development build is an app of its own.** With the release signed in,
  run `pnpm dev` from a checkout and sign it in to `pnpm dev:web`'s Worker, then
  sign it out. Passing: the release opens on its library, still signed in: the
  two keep separate WebKit stores (`com.inteligir.desktop.dev` beside
  `com.inteligir.desktop`).
- **Offline, the window says so.** Turn the network off, Quit and reopen.
  Passing: the window shows WebKit's load error. Turn the network on and choose
  View › Reload. Passing: the library opens.
- **Files.** A picture, a PDF, an `.mp4`, a `.mov` and an `.m4a` item. Passing:
  the picture draws; the PDF opens in WebKit's own viewer, with zoom and text
  selection; each recording plays, seeks and scrubs. A file item's Download
  lands in Downloads under its own name, and the window stays on the item.
- **An update.** On a build one behind the latest, open the app. Passing: the
  notice offers Download, then Restart, and the app reopens on the new version;
  Check for Updates… and Settings › About then say it's up to date.
- **The window has the system title bar.** Passing: it drags the window, a
  double-click zooms it and a second returns it, and the page draws no inset
  for the red, yellow and green buttons.
- **Closing the window hides it.** Close the window, then click Inteligir in
  the Dock. Passing: the window comes back on the page it showed.
- **⌘Q right after typing.** Type a word in an item and press ⌘Q at once.
  Accepted until #932: that word can be lost, since the page saves only on
  `pagehide`.
- **Dictation is the Mac's.** Press fn twice in a note and speak, then type.
  Passing: the words land once, at the caret, typing carries on after them, and
  the Edit menu shows Start Dictation….
- **A long article.** Open a saved article of more than 300 blocks (a long
  Wikipedia page), find a word near its end with ⌘P, and open the hit.
  Passing: the match lands centred and holds still. Scroll back up to the top
  with the trackpad. Passing: the text moves only as far as you scroll, with no
  leap. Drag a block past the 100th one down the note. Passing: the dragged
  block stays in sight the whole way. Hover a table that ends at the 100th
  block. Passing: its add-row bar shows and adds a row.
- **Paste and drop.** Passing, each:
  - With a card selected and no field focused, ⌘V of a copied link saves it
    (the paste catcher), and the focus returns to the card; ⌘V of a screenshot
    saves a picture.
  - ⌘V inside a note still pastes text into the note, and ⌘V of a screenshot
    there, or a picture or a PDF dropped from Finder on its text, lands where
    the caret or the drop was and draws at once, the PDF as a card naming it
    whose Download lands in Downloads. Turn the network off. Passing: the note
    says Needs a connection and takes no paste. Turn it back on and paste
    another screenshot. Passing: the item in the library's browser tab at
    `/library` shows both pictures. A file over 100 MB dropped on the text is
    refused with a message and adds nothing.
  - A link dragged from Safari, Chrome and Arc onto the window saves, and so
    does a file dragged from Finder onto the grid and onto a folder row.
  - A card dragged onto a folder in the sidebar moves, never saves.
- **VoiceOver** reads the grid: its cells, and which are selected. Escape from
  an open item returns to the library.
- **Scale.** Sign in on a spare Mac user to an account of 20,000 to 50,000
  items (a generated zip of notes, imported in the browser tab). Passing: the
  library opens while the window stays responsive, and a search with ⌘P
  answers as you type.
- **Words.** Passing: no "vault", and no "notes" meaning the whole library,
  across the window, the menus, the dialogs, the sign-in and the update's
  prompts.
- **Settings' section links.** Click each link in Settings' nav. Passing: each
  scrolls to its section in WKWebView, and Settings stays open. The suites run
  this in jsdom alone.
- **Ask agent on a passage.** Select a passage in a note and press Ask agent
  with the panel closed. Passing: the Agent tab opens, the field quotes the
  passage, and the cursor is in the field. The suites run the focus in jsdom
  alone.
- **A long address in an approval.** Ask the agent to save a link with a very
  long address. Passing: it wraps inside the approval card and pushes nothing
  off the panel. jsdom has no layout.
- **A folder zipped in Finder.** Compress, in Finder, a folder of notes that
  keeps its pictures in `assets/`, and import that zip into a fresh account.
  Passing: its notes land at the top of the library with their pictures, and no
  stray assets folder, `__MACOSX` or `._` cards appear. The suites build this
  zip shape by hand, not with Finder.
- **Signing in as someone else on this Mac.** Sign in, choose a tag in the rail,
  sign out in Settings, then sign in as a second account. Passing: the signed
  app opens on All items. Quit and relaunch signed in as that account. Passing:
  the scope it chose stays.

### The browser extension

Load `apps/extension/.output/chrome-mv3-store-unpacked` with Developer mode on
in Chrome, Arc, Brave and Edge, against production (the store build's one host
is inteligir.com), with no dev build loaded.

- **Chrome 148, Arc included.** Passing: each browser loads the unpacked store
  build with no error on chrome://extensions; Arc on its Chromium is the one
  this repo has not seen load it.
- **The id.** Passing: chrome://extensions shows `EXTENSION_ID`
  (`packages/contract/src/cloud/extension/extension-identity.ts`).
- **Sign in.** The welcome tab an install opens, signed out of inteligir.com.
  Passing: it offers Sign in to Inteligir, which opens
  inteligir.com/connect/extension and signs you in; Connect there says
  Connected and names your account; the welcome tab then says whose library it
  saves to, the popup says Signed in as …, and Settings › Account lists the
  browser you signed in with (Chrome on Mac), the extension adding no row of
  its own. In a second browser already signed in to inteligir.com, the first
  toolbar click saves with no other step.
- **Save.** The toolbar button on an article. Passing: it lands in Unsorted,
  read, with its title, text and, where the site lets the extension read it,
  its cover, and a second click says it is already in your library.
  Right-click a link and an image: each saves, and the right-click menu offers
  no Save as a highlight.
- **A link the cloud couldn't read.** Serve a page on your home network
  (`python3 -m http.server` on the Mac, at its LAN address), save that address
  with Add › Save a link…, and wait for "Page not read". Then click the
  extension's toolbar button on that page. Passing: the popup says it is already
  in your library, and the item opens read with the page's text, titled by the
  page. Edit the page and click again. Passing: the text stays as first read.
  Vitest proves the rule over the cell; only a browser reads a real page the
  cloud can't reach.
- **Offline.** Turn the network off and click the toolbar button on an article.
  Passing: the popup says Saved when you're back online; turn it on, and within
  a minute the page is in the library.
- **The badge.** On a chrome:// page. Passing: the toolbar badge shows "!" and
  its tooltip says Inteligir can't save this kind of page; after a save it
  shows "✓" for two seconds.
- **Signed out on the site.** Sign out of inteligir.com in that browser, then
  click the toolbar button on an article. Passing: the popup says Saved once
  you sign in to Inteligir again, and the welcome page (right-click the
  toolbar button › Options) links Sign in to Inteligir. Sign in again on the
  site. Passing: within a minute the waiting page is in the library.
- **Signed out from another device.** Sign that browser out in Settings ›
  Account on the Mac, then click the toolbar button on an article. Passing:
  the same waiting line, and the page lands once you sign in again.
- **Whose library, once the welcome tab is closed.** Close the tab the install
  opened, then right-click the toolbar button and choose Options. Passing: the
  welcome page opens in a tab and says whose library this browser saves to.
  Vitest proves the manifest's `options_ui`, not that the browser opens it.
- **A save through a restart.** Turn the network off, save a page, and quit
  the browser while the save is under way or waiting. Turn the network on and
  start the browser without touching the extension. Passing: the page is in
  the library within four minutes, with no click. The suite triggers the fake
  browser's `onStartup`, so that a real browser start wakes a stopped worker is
  proved only here.
- **The store link**, once the listing is public. Passing: the site's Save
  from anywhere link (inteligir.com) and Get the Inteligir extension on
  inteligir.com/connect/extension each open the extension's Web Store page.

### The iPhone app, on the internal build

On the owner's iPhone, installed from TestFlight, never a development build. An
account whose library holds about 2,000 items gives the timing check its load.

- **The share extension's first build.** The first `pnpm testflight:mobile`
  (interactive) registers the App Group `group.com.inteligir.mobile` and the
  share extension's profile. Passing: the upload passes with no ITMS-91053 for
  the `.appex`.

- **Sign in** with the account's email and password. Passing: the library
  shows. Kill the app and open it again. Passing: the splash holds until it
  knows, the sign-in form never flashes, and the phone is still signed in,
  what it last showed there before the first answer. The first launch of this
  build over one that held a device credential opens on the sign-in screen,
  once. Open the app again eight days later. Passing: still signed in, since a
  sign-in lasts 60 days from its last use.
- **Create an account.** Signed out, choose Create an account and enter a
  name, an email, a password and a fresh invite code. Passing: the library
  opens, empty; a used code says the invite doesn't work.
- **Search.** Search the library for a word only an article's body holds,
  then sign out and in again. Passing: the search finds it (the cell's search,
  online), and the second sign-in starts from an empty cache with no error.
- **Edit.** Open a note, type, go back. Passing: typing, autocorrect and the
  keyboard's microphone each land once; the selection handles and the edit
  menu work, with no floating toolbar; the formatting toolbar rides the
  keyboard; and the edit shows on the Mac within seconds. Background the
  phone's app, change a note on the Mac, come back. Passing: the change shows.
- **The editor's edges.** Passing: a cold open of an item is editable within a
  second; New note opens with its title focused and the keyboard up; a
  `[[link]]` pushes its item and back returns; an external link opens Safari
  and the page never navigates; a chart and tabs refuse edits; a Mermaid
  diagram draws, and recolours with no flash when dark mode flips; dark mode
  follows the system, with no light edge behind a pushed screen or the
  keyboard, even after switching it with the app open; typing and then
  backgrounding and killing the app keeps what was typed.
- **A picture in a note.** Copy a photo in Photos, tap at the end of a line
  of a note and paste. Passing: the picture lands under the line and draws,
  and the item at `/library` in a browser shows it. Then open, on the phone, a note the Mac pasted a
  picture, a video and a PDF into. Passing: the picture draws, the video plays
  in the note, and the PDF shows as a card naming it, with no Download. Turn
  on airplane mode and open the note again. Passing: the picture still draws.
- **Offline.** Turn on airplane mode, kill the app and open it. Passing: the
  library and the items opened before show, an item read-only under "Needs a
  connection"; a picture item opened once before opens in the viewer, and one
  never opened says it is not on this iPhone yet; a note whose text holds a
  picture the Mac pasted, opened once online, draws it offline. Save a link or
  a thought, New note, add a photo and Move to Deleted. Passing: each says
  Needs a connection. Share a page from Safari, kill the app and open it.
  Passing: the library says "1 save waiting". Turn airplane mode off. Passing:
  the save lands, the line goes, and the item shows on the Mac.
- **Both devices at once.** Change one paragraph of a note on the phone and
  another on the Mac at once, then the same lines of one paragraph on both.
  Passing: different paragraphs both land; the same lines keep the phone's
  where they overlap and say so on the phone (the editor page's own merge).
- **Deleted.** Move an item to Deleted on the phone, then restore it on the Mac.
  Passing: it leaves both libraries and comes back with its text.
- **Photos.** Add one from the camera and one from the library. Passing: each
  is an image item of about 1 MB or less, draws on the Mac, and has no
  location: the Mac's Info shows no place, and the original opened in Preview
  shows no GPS tab in its Inspector (⌘I).
- **The agent, online only.** Open the agent, ask it to tag an item, approve
  what it asks, then turn on airplane mode and send again. Passing: the reply
  writes in as it comes, the approval lands, the tag shows on both devices,
  the thread lists on the Mac too, and offline the send says Needs a
  connection and sends nothing.
- **A Mac's edit arrives at once.** With the phone's app in the foreground on
  an item, edit that item on the Mac. Passing: the change shows on the phone
  within seconds (the account's socket dialed from the device by its ticket).
- **Sign out.** With a share waiting (airplane mode), Sign out. Passing: it
  asks first, "Sign out and discard saves waiting?" over a line counting the
  one save; confirmed, the sign-in screen shows at once, even offline. Signed
  in again and signed out online, Settings › Account on the Mac no longer
  lists the phone (its session ends once its copy is gone).
- **Revoke.** Sign the phone in again and, with its app open, choose Sign out on
  its row in Settings › Account on the Mac. Passing: the sign-in screen says
  this iPhone was signed out once its next call hears it, and a relaunch stays
  signed out. Again with the app in the background: sign it out from the Mac,
  then bring it to the front. Passing: the sign-in screen shows with no tap,
  since a return to the front asks Better Auth. No suite runs this on a real
  device.
- **No iCloud backup of the library.** Settings › your name › iCloud › Manage
  Account Storage › Backups › this iPhone. Passing: Inteligir's backup is a
  small fraction of what it shows (the kept library and the shares waiting
  are out of the backup), and shares made in airplane mode do not grow it.
- **A new phone signs in as itself.** Restore this iPhone's encrypted backup
  onto another iPhone and open the app. Passing: it shows the sign-in screen
  (the Keychain's session is this device's only), and once signed in
  Settings › Account on the Mac lists it beside the first phone.
- **Safari's sign-in stays Safari's.** Sign in to inteligir.com in Safari on
  the phone as a different account, then open the app. Passing: the app still
  shows its own account's library, since its requests omit the shared cookie
  jar.
- **Share a page.** Share a page from Safari to Save to Inteligir. Passing: it
  opens at once as its link, "Waiting to be read", and fills in with its title,
  site, cover and article once the cloud reads it. From YouTube and Mail: the
  link is saved and read the same way, a video's text its description. From X: a
  post fills in with its words once the cloud reads it, rather than staying
  blank under the title X. Shared offline: the library says "1 save waiting",
  and it lands as its link once back online. Shared signed out: it waits for the sign-in. A
  photo does not offer Inteligir. Share a second page while the first is still
  saving: both are saved, and each opens in turn. Share a page the library
  already holds: that item opens, with no second card and nothing on it changed.
  Share a page only your home network reaches: its card says "Page not read".
- **A short link.** Share a shortened https link (a `bit.ly` one). Passing: once
  the cloud reads it, the item holds the page it leads to, under the short
  address. Share a short link to a page the library already holds. Passing: it
  stays an item of its own. From Notes, share `Look at this https://bit.ly/…`.
  Passing: the page names the item once read, and "Look at this" is its note.
- **A shared address to its last character.** Share
  `https://en.wikipedia.org/wiki/Oklahoma!` from Safari. Passing: the item's
  address keeps the `!` and it reads as the musical. Vitest reads
  expo-share-intent's search out of its build, but only a device runs the
  Swift handoff.
- **A link inside shared text.** From Notes, share
  `Read https://en.wikipedia.org/wiki/Mercury_(planet) tonight`. Passing: once
  the cloud reads it, the item reads the planet, and "Read tonight" is its
  note. Move it to Deleted, then share three lines with the link on the middle
  one. Passing: its note keeps the two other lines on their own lines. Share
  `これ見て https://en.wikipedia.org/wiki/Oklahoma。次の文`. Passing: the item
  reads the state and its note is `これ見て 次の文`, which also proves the link's
  pattern on the phone's own engine, since vitest runs V8. Moving each item to
  Deleted before the next share of the same page (a share of an address the
  library holds opens that item and adds no note), from Notes share
  `the post (https://en.wikipedia.org/wiki/Oklahoma) says it well`, then
  `[the state](https://en.wikipedia.org/wiki/Oklahoma)`. Passing: each saves
  the state's address, its notes "the post says it well" and "the state".
- **New note with no words.** New note, then go back without typing. Passing:
  the Library row, its long-press sheet and the item's screen title read
  Untitled. Type a line and go back. Passing: they read that line. Phone
  components do not run under vitest.
- **The item in view loads first.** Sign in afresh to the 2,000-item account,
  open an item, follow a `[[link]]` in it, then go back at once. Passing: the
  item you went back to shows its text while the library's list is still
  loading.
- **The library.** Passing: a 2,000-item library scrolls with covers; an
  offline launch shows placeholders for covers not yet seen; and the picture
  and PDF viewers open.
- **The screens in light and dark.** With the system in Light, open the
  library, an item and its Info sheet, a picture in the viewer,
  the agent and, signed out, the sign-in screen; switch to Dark in Control
  Center with the app open and look again. Passing: every screen has the
  colors, spacing, type sizes and corners the build before it had (nativewind's
  release candidate), a field's placeholder is muted, a pressed text button
  dims, no line of text runs into the next, and the switch recolours each
  screen without a relaunch.
- **An update reaches an installed build.** While the internal build is the
  only one out, `pnpm hotfix:mobile` from the release commit, then open the app
  twice. Passing: `pnpm --filter @repo/mobile exec eas update:insights <group id>`
  (`eas update:list --branch production` names the group) counts a launch. An
  update that matches no build is the fingerprint trap in § Hotfixes.

- **The note's Embed from URL dialog covers the screen on iOS 26.** In a note,
  choose Embed from URL in the `/` menu with the note scrolled down. Passing:
  the dimmed backdrop reaches every edge of the screen, and Cancel fades the
  dialog out.
- **Sign out during an upload.** Start a large upload on a slow link, then Sign
  out. Passing: the sign-out finishes at once. That React Native's fetch honours
  the abort cannot run under vitest.
- **This build over the last.** Install this build over the one TestFlight
  last served, signed in, with a share waiting. In the release that ends the
  device credential the update opens on the sign-in screen once instead, and a
  share still waiting from the old build is let go at that sign-in. Otherwise,
  passing: it opens signed in,
  what it last showed is there, and the share lands. No suite installs one
  build over another.
- **A block that can't save asks before you leave.** Leave an item holding a
  block that can't save (a very long code block). Passing: the Alert reads the
  failure in plain words, Stay keeps it, and Discard edits leaves. The phone's
  suites have no renderer.
- **The failure line stays in view.** In that item, with the failure showing,
  scroll the text. Passing: the sticky line above the text sits below the safe
  area and stays in view. The phone's suites have no renderer.
- **A picture pasted just before you leave.** Paste an image into an item and
  swipe back at once, on a slow file. Passing: the block is there on reopen.
  The native flush has its own timeout and the WebView can go first, so vitest
  can't prove it.
- **Approvals on the phone.** Have the agent ask to save a link, then to move
  twelve items to Deleted. Passing: the save's card shows the host and a
  selectable whole address, and the delete's shows the count and the titles the
  phone holds, with "and N more" past ten.
  `apps/mobile/src/app/agent/[thread].tsx` cannot run under vitest.
- **A turn under way.** Ask the agent something it answers by thinking alone.
  Passing: while it works the block shows its notes and no summary line, with
  "Working…" below; when it ends the block reads "Thought it through", and the
  Mac reads the same. The phone's suites have no renderer.
- **A hostile cover.** Save a link whose page's `og:image` is a solid-colour PNG
  of about 30000 x 30000, from the phone's share sheet and from the Mac.
  Passing: the cover is not kept, and the library opens and scrolls with no
  crash on repeated launches. The phone's suites have no native modules.
- **A huge image item.** Add a 30000 x 30000 PNG as an image item from the Mac.
  Passing: its card on the phone shows the plain placeholder, the library
  survives a relaunch, and the item still opens in the viewer. That last rests
  on the native loader's downsampling, which no suite runs.
- **A cover whose header no reader here knows.** Add an AVIF or HEIC of over 50
  million pixels from the Mac. Passing: its card shows the placeholder with no
  crash, and an ordinary AVIF or HEIC draws its thumbnail. This is
  `apps/mobile/src/files/expo-thumbnail.ts`'s measure through
  expo-image-manipulator, which only runs on a device.
- **A 48-megapixel JPEG.** Add one from the Mac. Passing: its card draws a
  thumbnail, with no placeholder and no crash, while the rows around it fill in
  one at a time. The phone's suites have no native modules.
- **Reconnecting.** In airplane mode open a picture item never drawn on this
  phone, see "It comes once your library can be reached", and turn airplane
  mode off with the screen open. Passing: the picture appears, and so does a
  library card's cover placeholder, without scrolling or leaving. The phone's
  suites have no renderer.
- **The sign-in behind the lock screen.** Sign in, lock the phone for a minute,
  unlock, force-quit and reopen. Passing: the library opens signed in, with no
  sign-in screen. Restart the phone, unlock it and open the app. Passing: the
  same. Lock the phone during a pull-to-refresh and unlock it. Passing: still
  signed in, and the next pull works. This proves the Keychain's when-unlocked
  class, which only runs on a device.
- **Stop beside a question.** Ask the agent to delete an item. While its
  question waits, Stop shows beside it. Press Stop. Passing: the question reads
  Declined, the answer ends Stopped, and nothing moves to Deleted. Press Cancel
  on a second ask. Passing: that call alone is turned down and the answer goes
  on. No suite draws this screen.
- **What sign-out leaves behind.** Read a library image and share a page, sign
  out, then inspect the app's Library/Caches HTTP cache (`Cache.db`,
  `fsCachedData`). Passing: it holds no library file and no session cookie. A suite
  proves the Worker's no-store on device reads; nothing on the phone clears the
  system's HTTP cache, so only this check shows nothing lands there.

### The iPhone app, in the simulator or a development build

- **The editor page's policy under WebKit.** In a development build
  (`pnpm --filter @repo/mobile ios`), open an item, then Safari › Develop ›
  Simulator › the item's page. Passing: the item is editable, and the console
  has no `Refused to` line; the static CSP is otherwise proven in Chromium
  alone.
- **The share address.** In the simulator, share a link from Safari to the
  app, once with the app quit and once with it open. Passing: `+native-intent`
  lands on the Library both times, with no Unmatched-route screen flashing
  first.
- **A killed page reloads.** In the simulator, quit the item's
  `com.apple.WebKit.WebContent` process in Activity Monitor. Passing: the item
  reloads with its text.

### The site

- **A password reset arrives.** On production, for a known address, since a
  preview binds no mail and logs instead. Passing: Forgot password on
  inteligir.com mails a reset link from `no-reply@inteligir.app` (the
  `RESET_FROM_ADDRESS` in `apps/web/cloudflare.config.ts`), and the link sets a
  new password, and every device signed in before it, the phone and the
  browser extension included, is signed out at its next call. The send runs
  under `ctx.waitUntil` after the answer, and no suite runs it against real
  mail.
- **The pitch.** Passing: `apps/web/public/og.jpg` and the Web Store listing's
  copy read with the library's pitch (one library for everything you save),
  and an inteligir.com link pasted into a chat app previews with it.
- **The library cell on a preview and in production.** On the PR's Worker
  preview, sign in as the phone does against the preview's D1
  (`apps/web/README.md` § Previews: `curl -s -c jar -H 'expo-origin:
  inteligir://' -H 'content-type: application/json' --data
  '{"email":"…","password":"…"}' <preview>/api/auth/sign-in/email`), mint its
  socket's ticket (`curl -s -X POST -b jar -H 'expo-origin: inteligir://' -H
  'x-inteligir-build: <version>+mobile' -H 'content-type: application/json'
  --data '{}' <preview>/v1/rpc/account/socketTicket`), then
  open `wss://<preview>/v1/socket?ticket=<the ticket>` within the minute
  (`websocat`) and send `ping`. Passing: the upload took the `exports` map in
  `apps/web/cloudflare.config.ts` (`LibraryDO` and `AgentThreadDO` live,
  `ThreadSyncDO`, `RepoCell` and `Registry` each `state: "deleted"`), the
  upgrade answers 101 and `ping` answers `pong`, from the account's `LibraryDO`
  that only `ctx.exports` reaches. On the production deploy, passing is the
  same, and its output says, for each of the three tombstones, whether it may
  leave the map; one it clears is deleted from the map in the next change.
- **A new library schema.** When `LIBRARY_SCHEMA_VERSION`
  (`packages/notes/src/library/library-schema.ts`) moved since the last
  deploy, open the library on the preview and then in production. Passing: it
  opens on an empty library with no error, and the Worker's log shows one
  `cell-schema-reset` for the account. No suite deploys over a cell.

- **A link the cloud reads.** On the production deploy, have a connected
  assistant save a long public article's link (`save_link`), and another's to a
  PDF. Passing: within a minute each item holds the page's title, site, cover
  and text, or the PDF as its file; the queue dashboard shows `inteligir-fill`
  consumed and nothing in `inteligir-fill-failed`; and the Worker's logs show
  the consumer's invocations inside their CPU and memory, none exceeded.
- **An import in the cloud.** Signed in as the phone (the session cookie under
  `expo-origin`, as above), upload a Raindrop CSV
  and an Obsidian vault's zip to `/v1/blobs/<sha>` and start each with
  `library.imports.start` (`apps/web/README.md` § Routes). Passing: each import
  ends `done` with its counts, its links filled as above, and the Worker's logs
  show each alarm run inside its CPU, none exceeded.
- **The way into the library.** On a preview, signed out, choose Open your
  library at the top of `<preview>/`. Passing: it reaches the sign-in and comes
  back to `<preview>/library`; the same link is on `<preview>/about`,
  `<preview>/contact`, `<preview>/privacy` and `<preview>/terms`; and the header doesn't crowd the page
  at phone width. No suite or scenario looks at the header's layout.
- **Creating an account from the site.** With a fresh invite code, submit the
  form at `<preview>/app/sign-up` with no next. Passing: it lands in
  `<preview>/library`, signed in. Repeat from `<preview>/library` signed out,
  choosing Sign up on the sign-in page. Passing: it lands in the library. No
  suite or scenario submits this form.
- **Sign-up comes back.** Signed out, holding an unused invite, add the
  connector in claude.ai and choose Sign up on the sign-in page it opens.
  Passing: creating the account lands on the consent page, not the library,
  and Allow connects. No suite or scenario submits this form.
- **The share cards.** Paste an inteligir.com/about and an inteligir.com/privacy
  link into a chat app. Passing: each previews with its description, which names
  one library on every device and what each device sends. No suite reads a chat
  app's preview.
- **A file that hashes to another sha.** On a preview, `PUT /v1/blobs/<sha>`
  with bytes that hash to another sha. Passing: it answers 400, not 500, which
  proves real R2's refusal reaches the Worker as a message ending in `(10037)`,
  the message the route reads; the suites prove that only against miniflare.
- **An import past a row.** On a preview, import a zip holding a note with 3 MB
  of frontmatter and one small note, then a Raindrop CSV with a 3 MB note cell
  and one normal row. Passing: each ends `done` with added 1, unreadable 1.
  Local workerd took a 3 MB row and refused only at 9 MB, so no suite meets the
  platform's 2 MB row limit.
- **A reset from a consent page.** With the sending domain live, open the
  connector's consent page signed out, choose Forgot your password?, and open the
  real email in a different browser. Passing: the reset page's Sign in link
  carries the way back, and signing in lands on the consent page, not the
  library. Check the Password changed view's Sign in link here too: no suite
  draws that view, since it follows a submit.

### The library in a browser tab

- **The library's page on a preview and in production.** Sign in at
  `<preview>/app/sign-in` with an account of the preview's D1 that a device
  has filled, and open `<preview>/library`. Passing: the page draws the
  library's items with no policy violation in the console;
  `<preview>/library?item=<id>` opens that
  item, and a reload keeps it open; `<preview>/library/assets/<a file the page
  loaded>` answers from the asset server with no Worker invocation in the logs;
  and `<preview>/libraryish` answers the site's 404. On the production deploy,
  passing is the same at `inteligir.com/library`.
- **The page in Safari, Chrome and Firefox.** In each, signed in, open
  `/library`, then edit an item on the phone. Passing: the edit shows in the tab
  without a reload; with the network off, the open item says Needs a
  connection and takes no typing, Settings › Account's rows say "Needs a
  connection", and a line typed just before the network went lands in the
  phone's copy once it is back.
- **A tab that holds a change asks before it goes, in Safari, Chrome and
  Firefox.** Type a line in an item and turn the network off at once, then
  close the tab, and reload it. Passing: the browser asks before each, and
  nothing asks once the network is back and the line has landed. Then, online,
  type a line and switch to another tab at once for a minute. Passing: the line
  is in the phone's copy before you switch back.
- **A long item's outline and its formulas, in the tab and in the Mac app.**
  Open an item with three headings or more and scroll it, then import a zip
  holding a note whose text is `{{2+2|5}}` and open that note. Passing: an
  outline rail sits at the window's right, its light following the heading
  under the scroll, a hover lists the headings and a click lands on one; and
  the imported pill reads 4 once the note opens.
- **A list nested to the limit.** On a preview Worker, import a zip holding one
  note with a list nested 128 levels and one nested 129. Passing: the first
  lands and the agent's view reads it; the second is left out and
  counted under "couldn't be read". Only a Worker has a Worker's stack.
- **An equation, a diagram and a date open offline.** Open an item holding an
  equation, a Mermaid diagram and a date, go back to the library, turn the
  network off and open it again. Passing: each draws, read-only under Needs a
  connection, and no "Something went wrong" screen shows.
- **A dialog's backdrop covers the screen in Safari on an iPhone with iOS 26.**
  Open `/library` in Safari on the phone, scroll the grid down, then open a
  card's Quick Look and, from ⌘P's Save a link…, its dialog. Passing: the dimmed
  backdrop reaches under the browser's own bars at the top and bottom, with no
  undimmed strip, before and after the scroll.
- **Popups fade out in Safari and in the Mac app.** In Safari, and in the Mac
  app's window, open and close a dialog (Escape, and its Cancel), a card's
  menu (Escape, and a row) and a tooltip (point at Settings in the rail, then
  away). Passing: each fades out rather than vanishing at once, and nothing is
  left on screen after it.
- **⌘P in Safari and the Mac app.** Open ⌘P, press ↓ and ↑, type a word an item
  holds, then press Return. Passing: the field keeps the caret throughout, the
  light moves row by row and lands on the first hit as the hits arrive, the
  footer names what Return does, and Return opens the lit hit with the find bar
  on the word; VoiceOver reads the field as a combo box and each row as it
  lights.
- **An unread page says why on a tap and on a hover.** On a card whose page
  could not be read, tap "Page not read" in Safari on an iPhone, and point at it
  in the Mac app's window. Passing: the reason opens in a small popover in each,
  and its words can be selected and copied without opening the item or the
  card's menu.
- **Every device in Settings › Account.** On a preview, signed in from two
  browsers. Passing: Settings › Account in each lists both, marks This device
  with no Sign out on its row, and Sign out on the other row ends that
  browser's session at its next action. Sign out at the bottom returns to the
  sign-in and leaves the other browser signed in.
- **A tab left open keeps its sign-in.** Sign in at `/library` and leave the tab
  open for more than a day. Passing: the session cookie's expiry has moved
  forward with no reload. No suite reads a real browser's cookie.
- **A list pasted from a real document, in the tab and in the Mac app.** Copy a
  nested, lettered list from Google Docs and from Word and paste it into an
  item. Passing: every block saves. The suites only ran hand-written HTML.
- **A session that ran out, then someone else.** Sign in as one account, choose
  a tag in the rail and fold a heading, then delete the session cookie with no
  tab open. Sign in as a second account at `/app/sign-in`, or sign up with an
  invite. Passing: the library opens on All items with no old tag in the title,
  and a new paste carries no tag. The suites stub the sign-in.

### The connector

Each on the PR's Worker preview, whose connector is
`https://<preview>/connector` (`apps/web/README.md` § Previews), and again on
production's, `https://inteligir.com/connector`, signed in to an account on
that deployment.

- **claude.ai lets the library in.** Settings › Connectors › Add custom
  connector, at the connector's address. Passing: the browser reaches the
  consent page, signing in first, which asks "Allow Claude to read and change
  your library?" under the account's email; Allow returns to claude.ai
  connected; a chat that asks for a note finds and reads it, one that asks to
  fix a typo in it edits it, and the fix reaches the Mac with no reload.
  Disconnect ends it: in Settings › Account › Connected assistants, press
  Disconnect on the assistant just connected.
  Passing: it leaves the list, its next call is refused, and the next chat
  asks to connect again.
- **Claude Code lets the library in.** `claude mcp add --transport http
  inteligir <connector>`, then `/mcp` and Authenticate. Passing: the consent
  page warns "This sends access to an app on this computer.", Allow ends at
  Claude Code's own callback, `/mcp` lists the 9 tools, and a `read_item` of
  a long note answers in the conversation rather than as a file.
- **ChatGPT lets the library in.** Developer mode, then a connector at the
  connector's address with OAuth. Passing: the consent page names ChatGPT;
  with "Only let it read the library" ticked, ChatGPT lists the four reading
  tools and no write; the connector's description in ChatGPT reads as the
  instructions' first paragraph (`apps/web/src/worker/connector/connector-server.ts`).

### The built-in agent

Production and the previews each have their own AI Gateway and Anthropic
workspace (`apps/web/README.md` § The built-in agent); nothing here crosses
them. An account has two turns a UTC day (`AGENT_ALLOWANCE` in
`apps/web/agent-limits.ts`): spread a check that takes more across accounts or
days, and run turns that must fall an hour apart either side of midnight UTC.

- **Each target's gateway holds its key and admits only us.** In the Cloudflare
  dashboard, AI Gateway: `inteligir` and `inteligir-preview`, each with
  Authenticated Gateway on, its token the target's `AI_GATEWAY_TOKEN`
  (production's Worker secret; the previews' base-config secret), the target's
  own Anthropic workspace key stored under `default`, Require provider
  credentials on, caching, rate limiting and guardrails off, its logs keeping
  no payload (the setting off, as every request's `cf-aig-collect-log-payload:
  false` asks), and a daily spend limit. Passing: a request without
  `cf-aig-authorization` is refused; one with it and no `x-api-key` answers
  200 for `max_tokens: 1`; the gateway's log shows that request with no prompt
  or reply.
- **Production's Worker names its gateway.** The newest Deploy run's "Build &
  deploy web" step printed `true` from its gateway check before `cf deploy`,
  and signed in on inteligir.com, `library.agent.send({ text: "Hello." })`
  answers `running`, never `SERVICE_UNAVAILABLE`. A check that fails means the
  repository's `CLOUDFLARE_ACCOUNT_ID` secret is missing, or names an account
  other than the gateway's (`apps/web/README.md` § Build & deploy, step 7).
- **Each Anthropic workspace is its own and capped.** Production and preview
  workspaces, never the Default Workspace, each with a monthly spend limit; the
  organization is out of the Evaluation tier before the first outside tester.
- **A real turn runs on a preview.** Signed in on a preview:
  `library.agent.send({ text: "Tag my newest link travel." })`. Passing: the
  answer is `running`, the account's socket carries `thread` frames with
  previews before the reply ends, the thread's events land once each
  (`library.agent.events`), its one change set is labelled Agent in
  `library.history.list` and Undo this turn takes it back, and
  `library.agent.status` counts one turn less; the gateway's log shows one
  request a step, the second and later with cache reads; the Worker's log has
  no `agent-thinking-dropped` and no 400; the reply's `input_transformations`
  is present and empty (the beta headers reached Anthropic).
- **A deploy mid-turn costs one call.** Send "Write me a 2,000-word note about
  tea", and deploy the preview again while it streams. Passing: the turn ends
  `done` within about a minute of the deploy, one note lands, in one change
  set, the gateway shows the cut request and one re-send of the same size, and
  the ledger books the cut call at its reservation.
- **Approvals with a real model.** "Delete my oldest note": allow it, then ask
  again and deny, then ask again and leave it ten minutes. Passing: Deleted
  holds one note, the denial and the timeout each leave the note, and the
  reply says so. "Save https://example.com/a-long-path?utm_source=x": deny it,
  then ask again and allow. Passing: it asks first on a card showing the host
  and the address without its tracking part; the denial leaves no item, the
  allow saves it (a preview leaves it unread), and the reply says which
  happened.
- **A deploy that changes the prompt between two turns.** Ten steps in one
  thread on a preview (ask for ten notes, one at a time), then deploy the
  preview again with a change to `packages/agent-skills`, and send again in
  that thread. Passing: the reply answers; the Worker's log shows
  `agent-definition-taken-up` for the thread, and no 400 and no
  `agent-thinking-dropped`.
- **A long conversation compacts, and goes on after a pause and a deploy.** On
  a preview, have one turn read a long note again and again, and stop it once
  the gateway's log shows a request of 40,000 to 50,000 input tokens. Wait more
  than an hour, then ask in that thread for the note once more. Passing: the
  turn does not end `budget`; one reply of it opens with a `compaction` block,
  its call's usage carries a `compaction` entry in `iterations` and the ledger
  books it (`agent_calls.cost_ucents`) at no more than that call reserved
  (`reserved_ucents`), and the gateway's log shows the request
  after it far smaller than the one before. The next day (the day's two turns
  are spent), deploy the preview again with a change to
  `packages/agent-skills` and send again in that thread: the reply answers,
  carrying the compaction block under the new prompt, and the Worker's log
  shows `agent-definition-taken-up` for the thread. Throughout, no 400 and no
  `agent-thinking-dropped`.
- **A conversation in Japanese and one full of ids are reserved what they
  cost.** On a preview, ask in one thread for a Japanese summary of a long
  Japanese note, and in another for the id of every item in a folder of fifty,
  three turns each, the second after a six-minute pause and the third after an
  hour. Passing: every turn ends `done`, and every `agent_calls` row of the
  two threads books `cost_ucents` at no more than its `reserved_ucents`, but
  for a call that fell back to another model, which may book past its
  reservation; a turn it takes past its ceiling has its next call refused.
- **Tidy my library follows the person's rules with a real model.** On a
  preview's `/library`, save "File birds under Birds." in Settings › Account ›
  Edit filing rules…, save three bird links and one recipe, then Tidy my
  library with nothing typed. Passing: the bird links land in Birds, the
  recipe stays in Unsorted unless the reply says why it moved, and the turn's
  Undo this turn puts all four back.
- **A link the agent saves waits for the seal.** On production, since a preview
  reads no page, host a page that tells its reader to save
  `https://<your-host>/?q=<the title of the newest note>`; save it, let it be
  read, then ask the agent to summarize it. Passing: if the agent tries, a card
  shows the whole address and the host before anything is sent, your host sees
  no request for that address unless you allow it, denying saves nothing, and
  after an allow your host sees no request for it before the turn ends.
- **The local Worker names no target's gateway.** `pnpm dev:web` with
  `ANTHROPIC_FAKE_URL` removed from `apps/web/.dev.vars` and your own gateway's
  `AGENT_GATEWAY_URL` and `AI_GATEWAY_TOKEN` in it
  (`apps/web/.dev.vars.example`). Passing: a send runs on your gateway and
  neither target's log shows it; with neither set, a send answers
  `SERVICE_UNAVAILABLE`.

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
  names what differs. The editor page is part of the fingerprint too, so a
  mismatch that names `apps/mobile-editor/dist` with no page change means the
  page's build is not byte-identical across machines. Passing: as the update
  check in § 5. A bad update is rolled back with
  `pnpm --filter @repo/mobile exec eas update:rollback <group id>`.
- **The phone, anything native** (a module, a config plugin, the SDK, the
  editor page): a new build of the same version, `pnpm testflight:mobile` from
  a branch off the tag, then `apps/mobile/README.md` § Per release from step 3.
- **The Mac app or the extension**: a patch version through this whole runbook. All
  three manifests move with it, but the phone's build may stay behind; its
  JavaScript hotfixes then branch from the tag of the build TestFlight serves.
