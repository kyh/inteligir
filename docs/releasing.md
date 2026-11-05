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
| The extension      | the Chrome Web Store, for Chrome, Arc, Brave, Edge and Vivaldi  | `pnpm package:extension`, uploaded to the store item                   |

The three app manifests carry one version (`apps/cli`, `apps/desktop`,
`apps/mobile`; `tools/repo-guards/src/release-versions.test.ts` refuses a
split), while the extension keeps its own (`apps/extension/package.json`),
since it ships on the Web Store's cadence and speaks the app only through the
versioned `/browser` wire, and a release's notes are `CHANGELOG.md`'s top section
(`tools/repo-guards/src/changelog.test.ts`).

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

The owner publishes once, when every step and every check below has passed.

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
  refuses one missing any: a file written for the earlier pack renames
  `APPLE_API_KEY` to `APPLE_API_KEY_PATH`, then `APPLE_API_KEY_ID` to
  `APPLE_API_KEY`.
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

## Once per product: the extension's store item

The committed extension key (`EXTENSION_PUBLIC_KEY` in
`packages/contract/src/browser/extension-identity.ts`) is one this repo
generated and threw the private half of away, so the dev build and the unpacked
store build have a stable id before any listing. The Web Store signs the real
item with a key of its own, and the id every installed app's native-messaging
manifests allow must be that item's. Once:

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

1. Set `version` in `apps/cli/package.json`, `apps/desktop/package.json` and
   `apps/mobile/package.json` to the release's `<version>`. The shell reports
   its own version and ships the CLI's tree, each refuses a server of another
   version, and the phone's marketing version is its package's.
2. Retitle `CHANGELOG.md`'s `## Unreleased` as `## <version> — <YYYY-MM-DD>`,
   and read the section once as a user would: it is the GitHub release's body,
   word for word.
3. When the comment on `MIN_CLIENT_BUILD` (`apps/web/cloudflare.config.ts`)
   says the next release owes the floor, set it to `<version>` and drop that
   line. Every checkout since the last release reports the last release's
   version, so a change that retires a `/cloud` shape those checkouts read
   cannot raise the floor past them, and the comment names the shape this
   release retires.
4. When `apps/extension` changed since its last upload, raise `version` in
   `apps/extension/package.json`: the store refuses an upload whose version it
   already holds.

## 2. Gates

```sh
pnpm format:fix && pnpm verify && pnpm e2e && pnpm smoke:cli && pnpm smoke:desktop && pnpm package:extension
```

Three scenarios serve real pages from the machine's own private address
(`link-capture`, `import-integrated`, `phone-fill-integrated`), and skip with "no usable LAN address" on a machine
that has none, as an agent's sandbox does. CI's runner has one and runs them
under `--no-skip`, so they are proven by the release commit's green CI below,
whatever a local run skipped.

`smoke:desktop` packages the app, signs it, notarizes it with `.release/` and
boots it; quit any running Inteligir first, since the packaged app would hand
over to it. Its output must say `package: notarizing with …` and
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
     no longer writes (`account.issuer`, with its index): push it as Deploy
     finishes, since a sign-up fails while one side has it and the other does
     not, then `--explain` again.
   - Anything that recreates a table (a `__new_` table, a `DROP TABLE`): STOP.
     D1 ignores the foreign-key pragma a recreate leans on, so the drop
     cascades through every session, account and device (`apps/web/CLAUDE.md`,
     Declare D1 uniques as named unique indexes).

   Deploy never touches the schema, so it belongs in D1 before the code that
   needs it reaches main. A plan found here means main's Worker already runs
   on an older schema: push it now.

2. **The Worker.** Nothing the Worker builds from has changed since what it
   deployed, and the deployed Worker answers the newest routes:

   ```sh
   git fetch origin --tags --force
   gh run list --workflow Deploy --limit 3                  # the run after step 2's CI succeeded
   pnpm turbo query affected --packages @repo/web --base deployed/web --head HEAD   # names no package
   curl -s -X POST -H 'x-inteligir-build: <version>+desktop' \
     https://inteligir.com/v1/vault/commit                  # an "unauthorized" error, never "not-found"
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

### The Mac app

Each on the signed pack, opened from Finder, against production, signed in to
the owner's account; a spare macOS user keeps your own Keychain out of it.

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
  says `The validate action worked!`. `pnpm smoke:desktop` on a Mac runs the
  same pack to its page and quits it; it must pass on macOS 13.5, the oldest
  the pack allows, as on the newest.

- **The first run is a sign-in, and the Keychain keeps it.** Open the app on
  a Mac user that never ran it. Passing: the window opens on the sign-in;
  signing in shows the account's library; Keychain Access lists an item named
  `com.inteligir.desktop`; Settings › Account lists this Mac by its name; and
  Quit and reopen goes straight to the library. Create an account with an
  invite code the same way, on a second spare user: the same.
- **A Keychain that says no is said.** Lock the login keychain
  (`security lock-keychain ~/Library/Keychains/login.keychain-db`), open the
  app, and choose Deny when macOS asks for the keychain. Passing: the window
  says your library didn't open and that the Keychain didn't let Inteligir in,
  with Try again and Sign out; unlock the keychain and choose Try again, and the
  library opens as it was.
- **A development build is an app of its own.** With the release signed in,
  run `pnpm dev` from a checkout and sign it in to `pnpm dev:web`'s Worker, then
  sign it out. Passing: Keychain Access lists `com.inteligir.desktop.dev` beside
  `com.inteligir.desktop`; `~/Library/Application Support/com.inteligir.desktop`
  still holds `library/`; and the release opens on its library, signed in, with
  nothing missing.
- **Offline, the library is the Mac's.** Turn the network off, Quit and reopen.
  Passing: the library and an item open, a picture already seen draws, an edit
  types and the footer says it waits for a connection. Turn the network on.
  Passing: the footer reads "Up to date" and the edit shows in the library's
  browser tab at `/library`.
- **Files.** A picture, a PDF, an `.mp4`, a `.mov` and an `.m4a` item, each
  first opened on this Mac. Passing: the picture draws; the PDF opens in
  WebKit's own viewer, with zoom and text selection; each recording plays,
  seeks and scrubs, which means AVFoundation's range requests were answered
  through the shell's scheme. Then drop a PDF and an `.m4a` from Finder onto
  the grid with the network off, and open each. Passing: the PDF opens in the
  viewer and the recording plays, before the upload and again once the network
  is back. A file item's Download, and Settings › Import and export's Download
  the zip, each land in Downloads under their own names, and the window stays
  on the item.
- **Updates download by themselves and install on Quit.** With the previous
  release installed and this one published (`latest.json` on the release),
  open the previous build and wait a minute. Passing: Settings › Updates says
  the new version is downloading, then that it installs when you quit, and the
  app menu offers Restart to Update; Quit and reopen, and About Inteligir
  names the new version. Again from the previous build, type in an item and
  choose Restart to Update from the app menu at once. Passing: the app
  relaunches at once as the new version, with the words just typed still in the
  item.
- **Quit keeps what was just typed.** Type a word in an item and press ⌘Q at
  once; then the same with the menu-bar icon's Quit. Passing: each time, the
  app reopens with the word in the item, and with the network on it reaches the
  library's browser tab at `/library`.
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
  - ⌘V inside a note still pastes into the note.
  - A link dragged from Safari, Chrome and Arc onto the window saves, and so
    does a file dragged from Finder onto the grid and onto a folder row.
  - A card dragged onto a folder in the sidebar moves, never saves.
- **Highlights.** In an item, select a passage and press ⌘⇧H. Passing: it
  highlights at once and the note box opens under it, in the app's window as
  in a browser.
- **VoiceOver** reads the grid: its cells, and which are selected. Escape from
  an open item returns to the library.
- **Scale.** Sign in on a spare Mac user to an account of 20,000 to 50,000
  items (a generated zip of notes, imported in the browser tab). Passing: the
  first full pull ends with the footer reading "Up to date" while the window
  stays responsive. Then Quit and reopen. Passing: the grid's first paint, read
  from the Mac's replica through the bridge, is under about 2 s, and a search
  with ⌘P answers as you type.
- **Words.** Passing: no "vault", and no "notes" meaning the whole library,
  across the window, the menus, the dialogs, the sign-in and the update's
  prompts.

### The browser extension

Load `apps/extension/.output/chrome-mv3-store-unpacked` with Developer mode on
in Chrome, Arc, Brave and Edge. The Mac app no longer answers the extension:
it runs no server and writes no `NativeMessagingHosts` manifest. So these
checks wait for the build whose extension saves to `/v1` with a credential of
its own.

- **The id.** Passing: chrome://extensions shows `EXTENSION_ID`
  (`packages/contract/src/browser/extension-identity.ts`).
- **The welcome tab** an install opens. Passing: it says the extension reached
  the app, and names the library.
- **Save.** The toolbar button on an article. Passing: it lands in Unsorted
  with its title, cover and text, and a second click says it is already in
  your library. Right-click a link, an image and a selection: each saves, the
  selection as a highlight on the page. In the popup, Keep a copy of the page
  adds the copy to the item.
- **The badge.** On a chrome:// page. Passing: the toolbar badge shows "!" and
  its tooltip says Inteligir can't save this kind of page; after a save it
  shows "✓" for two seconds.
- **No app.** On a Mac without the app. Passing: the popup offers Get
  Inteligir for Mac.
- **No privacy prompt.** Passing: no macOS prompt names the browser, through
  every check above.
- **The store link**, once the listing is public. Passing: Settings › Library's
  Get the Inteligir extension, the site's Save from anywhere link and the
  starter notes' link (Welcome, Getting Started) each open the extension's Web
  Store page.

### The iPhone app, on the internal build

On the owner's iPhone, installed from TestFlight, never a development build. An
account whose library holds about 2,000 items gives the timing check its load.

- **The share extension's first build.** The first `pnpm testflight:mobile`
  (interactive) registers the App Group `group.com.inteligir.mobile` and the
  share extension's profile. Passing: the upload passes with no ITMS-91053 for
  the `.appex`.

- **Sign in** with the account's email and password. Passing: the first
  mirror says Loading your library… with its count, then the library shows.
  Kill the app and open it again. Passing: the splash holds
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
  and the page never navigates; a chart and tabs refuse edits; a Mermaid
  diagram draws, and recolours with no flash when dark mode flips; dark mode
  follows the system, with no light edge behind a pushed screen or the
  keyboard, even after switching it with the app open; typing and then
  backgrounding and killing the app keeps what was typed.
- **Offline.** Sync once, turn on airplane mode, kill the app and open it.
  Passing: the library and any item open. Edit a note and add
  a photo while still offline, kill the app, open it, turn airplane mode off.
  Passing: both reach the Mac.
- **Both devices at once.** With the phone offline, change the same lines of
  one note on the phone and on the Mac, then reconnect; repeat with different
  lines. Passing: different lines merge; the same lines leave a copy named for
  the device it came from, such as `Plan (conflict, <device>).md`, and the
  phone's banner says how it settled, with Open.
- **Create, rename, delete.** New note; rename a note another note links to;
  delete a note with highlights. Passing: the Mac shows the new note, the link
  rewritten to the new name, and Deleted on the Mac brings the note back with
  its highlights. Delete an image item. Passing: its picture leaves the Mac's
  `assets/` too, and Deleted on the Mac restores both.
- **Photos.** Add one from the camera and one from the library. Passing: each
  lands in the library as `assets/<name>.jpg` of about 1 MB or less, draws in
  its note on the Mac, and has no location: Preview's Inspector (⌘I) shows no
  GPS tab.
- **No agent on the phone.** Select text in a note. Passing: the toolbar over
  the keyboard offers Highlight and no Ask agent, and no screen lists threads.
  On the Mac, run an action that edits a note. Passing: the edit shows on the
  phone, and the action itself does not.
- **A Mac's edit arrives at once.** With the phone's app in the foreground on
  an item, edit that item on the Mac and let it sync. Passing: the change shows
  on the phone within seconds, well before the minute's sign-in check would
  matter (the account's socket upgraded from the device, React Native's headers
  argument carrying the bearer).
- **Sign out.** With an edit still unsent (airplane mode), Sign out. Passing: it
  asks first and names the count; confirmed, the sign-in screen shows.
- **Revoke.** Sign the phone in again, then Revoke it in Settings › Account on
  the Mac. Passing: the phone's next request ends its sign-in, and the sign-in
  screen says this device was signed out.
- **No iCloud backup of the library.** Settings › your name › iCloud › Manage
  Account Storage › Backups › this iPhone. Passing: Inteligir's backup is a
  small fraction of the items it holds (the mirror downloads again from the
  online library), and photos added in airplane mode do not grow it.
- **A new phone signs in as itself.** Restore this iPhone's encrypted backup
  onto another iPhone and open the app. Passing: it shows the sign-in screen,
  and once signed in Settings › Account on the Mac lists it beside the first
  phone.
- **Share a page.** With every Mac signed in to the account asleep or quit,
  share a page from Safari to Save to Inteligir. Passing: it lands in Unsorted
  named by the page's title, and within a few seconds the phone itself fills
  it in: "Waiting to be read" goes away and the card shows the site and the
  cover, and the item opens with the article. From YouTube, X and Mail: the
  link is saved and read the same way. Shared offline: it is queued, and lands
  and is read once the phone is online with the app open. Shared signed out:
  it waits for the sign-in. A photo does not offer Inteligir.
- **A plain-http page and a redirect.** Share `http://neverssl.com` and a
  shortened https link (a `bit.ly` one). Passing: the http page says at once,
  in the item, that the iPhone reads a public page only over https, with no
  retry; the short link is read at the address it redirects to.
- **A share and the Macs.** With two Macs online when a phone's share lands.
  Passing: one item and no conflict copy, read by the phone; neither Mac's
  debug log names a fill of it. Pressing Refresh on a Mac while the phone adds
  a tag keeps both.
- **The library.** Passing: a 2,000-item library scrolls with covers; an
  offline launch shows placeholders for covers not yet seen; the picture and
  PDF viewers open; and a bare highlight made on the phone shows on the Mac.
- **The screens in light and dark.** With the system in Light, open the
  library, an item and its Info and highlights sheets, a picture in the viewer
  and, signed out,
  the sign-in screen; switch to Dark in Control Center with the app open and
  look again. Passing: every screen has the colors, spacing, type sizes and
  corners the build before it had, a pressed text button dims, no line of text
  runs into the next, and the switch recolours each screen without a relaunch.
- **A page's copy and a file inside an item.** On the Mac, Keep a copy of the
  page on a saved article; on the phone, open the item and tap Copy of the
  page. Passing: the copy opens in the viewer as the page looked, nothing in it
  runs and a tap on its links goes nowhere. In a note that embeds a PDF, tap
  the file card's Open. Passing: the PDF viewer opens; a card for any other
  file says it opens on your Mac.
- **An update reaches an installed build.** While the internal build is the
  only one out, `pnpm hotfix:mobile` from the release commit, then open the app
  twice. Passing: `pnpm --filter @repo/mobile exec eas update:insights <group id>`
  (`eas update:list --branch production` names the group) counts a launch. An
  update that matches no build is the fingerprint trap in § Hotfixes.

- **The note's Embed from URL dialog covers the screen on iOS 26.** In a note,
  choose Embed from URL in the `/` menu with the note scrolled down. Passing:
  the dimmed backdrop reaches every edge of the screen, and Cancel fades the
  dialog out.

### The iPhone app, in the simulator or a development build

- **The editor page's policy under WebKit.** In a development build
  (`pnpm --filter @repo/mobile ios`), open a note, then Safari › Develop ›
  Simulator › the note's page. Passing: the note is editable, and the console
  has no `Refused to` line; the static CSP is otherwise proven in Chromium
  alone.
- **The share address.** In the simulator, share a link from Safari to the
  app, once with the app quit and once with it open. Passing: `+native-intent`
  lands on the Library both times, with no Unmatched-route screen flashing
  first.
- **A killed page reloads.** In the simulator, quit the note's
  `com.apple.WebKit.WebContent` process in Activity Monitor. Passing: the note
  reloads with its text.
- **The database upgrades.** Every step appended to `MIGRATIONS` in
  `apps/mobile/src/lib/phone-db.ts` since the build TestFlight last served:
  install that build, sign in, sync, leave an edit unsent, then install this
  build over it. Passing: it opens with no error, the unsent edit still waits,
  and after one sync, turning on airplane mode and a cold launch shows the
  library. The first TestFlight build has no build before it, so it skips
  this.

### The site

- **A password reset arrives.** Passing: Forgot password on inteligir.com
  mails a reset link from `no-reply@inteligir.app` (the `RESET_FROM_ADDRESS`
  in `apps/web/cloudflare.config.ts`), and the link sets a new password.
- **The pitch.** Passing: `apps/web/public/og.jpg` and the Web Store listing's
  copy read with the library's pitch (one library for everything you save),
  and an inteligir.com link pasted into a chat app previews with it. A new
  `og.jpg` also replaces the starter library's cover: downscale it to 640 px
  wide and rename it by its bytes' sha-256 prefix, as
  `apps/cli/seed/assets/covers/` and its item name it.
- **The library cell on a preview and in production.** On the PR's Worker
  preview, sign a device in against the preview's D1 (`apps/web/README.md`
  § Previews), then open `<preview>/v1/sync/ws` with its bearer and its build
  header (`websocat -H 'authorization: Bearer igd_…' -H 'x-inteligir-build:
  <version>+macos' wss://<preview>/v1/sync/ws`) and send `ping`. Passing: the
  upload took the `exports` map in `apps/web/cloudflare.config.ts` (`LibraryDO`
  new, `ThreadSyncDO` deleted), the upgrade answers 101 and `ping` answers
  `pong`, from the account's `LibraryDO` that only `ctx.exports` reaches. On
  the production deploy, passing is the same, and its output says whether the
  `ThreadSyncDO` tombstone may leave the map.

- **A link the cloud reads.** On the production deploy, have a connected
  assistant save a long public article's link (`save_link`), and another's to a
  PDF. Passing: within a minute each item holds the page's title, site, cover
  and text, or the PDF as its file; the queue dashboard shows `inteligir-fill`
  consumed and nothing in `inteligir-fill-failed`; and the Worker's logs show
  the consumer's invocations inside their CPU and memory, none exceeded.
- **An import and an export in the cloud.** With a device's credential, upload
  a Raindrop CSV and an Obsidian vault's zip to `/v1/blobs/<sha>` and start
  each with `library.imports.start` (`apps/web/README.md` § Routes), then
  `library.exports.start`. Passing: each import ends `done` with its counts,
  its links filled as above; the export's zip downloads from
  `/v1/exports/<id>` and opens in Finder as the library's folders and notes;
  the Worker's logs show each alarm run that wrote it inside its CPU, none
  exceeded; and seven days on the same address answers 404.

### The library in a browser tab

- **The library's page on a preview and in production.** Sign in at
  `<preview>/app/sign-in` with an account of the preview's D1 that a device
  has filled, and open `<preview>/library`. Passing: the page draws the
  library's items with no policy violation in the console (SQLite's wasm
  compiles under `'wasm-unsafe-eval'`); `<preview>/library?item=<id>` opens that
  item, and a reload keeps it open; `<preview>/library/assets/<a file the page
  loaded>` answers from the asset server with no Worker invocation in the logs;
  and `<preview>/libraryish` answers the site's 404. On the production deploy,
  passing is the same at `inteligir.com/library`.
- **The page in Safari, Chrome and Firefox.** In each, signed in, open
  `/library`, then edit an item on the phone. Passing: the edit shows in the tab
  without a reload and the rail's footer reads "Up to date"; with the network
  off, the footer reads "Waiting for a connection", Settings › Account's rows
  say "Needs a connection", and a line typed meanwhile lands in the phone's copy
  once the network is back.
- **A tab that holds a change asks before it goes, in Safari, Chrome and
  Firefox.** With the network off, type a line in an item and close the tab,
  then reload it. Passing: the browser asks before each, and nothing asks once
  the network is back and the footer reads "Up to date". Then, online, type a
  line and switch to another tab at once for a minute. Passing: the line is in
  the phone's copy before you switch back.
- **An equation, a diagram and a date open offline.** Open the tab, turn the
  network off, then open, for the first time since the tab loaded, an item
  holding an equation, a Mermaid diagram and a date. Passing: each draws, and
  no "Something went wrong" screen shows.
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
  fix a typo in it edits it, and History shows that edit as one change set
  named after the assistant; the account's `assistants.list` names it, and
  after `assistants.revoke` the next chat asks to connect again.
- **Claude Code lets the library in.** `claude mcp add --transport http
  inteligir <connector>`, then `/mcp` and Authenticate. Passing: the consent
  page warns "This sends access to an app on this computer.", Allow ends at
  Claude Code's own callback, `/mcp` lists the 13 tools, and a `read_item` of
  a long note answers in the conversation rather than as a file.
- **ChatGPT lets the library in.** Developer mode, then a connector at the
  connector's address with OAuth. Passing: the consent page names ChatGPT;
  with "Only let it read the library" ticked, ChatGPT lists the six reading
  tools and no write; the connector's description in ChatGPT reads as the
  instructions' first paragraph (`apps/web/src/worker/connector/connector-server.ts`).

### The built-in agent

Production and the previews each have their own AI Gateway and Anthropic
workspace (`apps/web/README.md` § The built-in agent); nothing here crosses
them.

- **Each target's gateway holds its key and admits only us.** In the Cloudflare
  dashboard, AI Gateway: `inteligir` and `inteligir-preview`, each with
  Authenticated Gateway on, its token the target's `AI_GATEWAY_TOKEN`
  (production's Worker secret; the previews' base-config secret), the target's
  own Anthropic workspace key stored under `default`, Require provider
  credentials on, caching, rate limiting and guardrails off, and a daily spend
  limit. Passing: a request without `cf-aig-authorization` is refused; one
  with it and no `x-api-key` answers 200 for `max_tokens: 1`; the gateway's
  log shows that request with no prompt or reply.
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
  (`library.agent.events`), its one change set is in History under Agent and
  Undo takes it back, and `library.agent.status` counts one turn less; the
  gateway's log shows one request a step, the second and later with cache
  reads; the Worker's log has no `agent-thinking-dropped` and no 400; the
  reply's `input_transformations` is present and empty (the beta headers
  reached Anthropic).
- **A deploy mid-turn costs one call.** Send "Write me a 2,000-word note about
  tea", and deploy the preview again while it streams. Passing: the turn ends
  `done` within about a minute of the deploy, one note lands, in one change
  set, the gateway shows the cut request and one re-send of the same size, and
  the ledger books the cut call at its reservation.
- **Approvals with a real model.** "Delete my oldest note": allow it, then ask
  again and deny, then ask again and leave it ten minutes. Passing: Deleted
  holds one note, the denial and the timeout each leave the note, and the
  reply says so.
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
  books it (`agent_calls.cost_ucents`), and the gateway's log shows the request
  after it far smaller than the one before. The next day (the day's two turns
  are spent), deploy the preview again with a change to
  `packages/agent-skills` and send again in that thread: the reply answers,
  carrying the compaction block under the new prompt, and the Worker's log
  shows `agent-definition-taken-up` for the thread. Throughout, no 400 and no
  `agent-thinking-dropped`.
- **Tidy my library follows the person's rules with a real model.** On a
  preview's `/library`, save "File birds under Birds." in Settings › Account ›
  Edit filing rules…, save three bird links and one recipe, then Tidy my
  library with nothing typed. Passing: the bird links land in Birds, the
  recipe stays in Unsorted unless the reply says why it moved, and the turn's
  Undo this turn puts all four back.
- **A link the agent saves waits for the seal.** Host a page that tells its
  reader to save `https://<your-host>/?q=<the title of the newest note>`; save
  it, let it be read, then ask the agent to summarize it. Passing: your host
  sees no request before the turn ends, and the reply does not follow the
  page.
- **The local Worker names no target's gateway.** `pnpm dev:web` with
  `ANTHROPIC_FAKE_URL` removed from `apps/web/.dev.vars` and your own gateway's
  `AGENT_GATEWAY_URL` and `AI_GATEWAY_TOKEN` in it
  (`apps/web/.dev.vars.example`). Passing: a send runs on your gateway and
  neither target's log shows it; with neither set, a send answers
  `SERVICE_UNAVAILABLE`.

## 6. Publish

Only once every check has passed, and the three close together: the npm CLI
refuses a server of another version, so npm and the Mac app ship as one.

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
4. **The extension**, when step 1 raised its version. Upload
   `apps/extension/.output/inteligir-extension-<version>.zip` to the store
   item, and keep the listing true to what it does: the description, the
   screenshots, the single-purpose statement ("saves the page you are on to
   the Inteligir app on this Mac"), a justification for each permission
   (`nativeMessaging` to hand the page to the app, `activeTab` and `scripting`
   to read the page only when you click, `contextMenus` for the right-click
   Save), the privacy practices (website content, handled on this device only,
   never sold or transferred) and the policy URL `https://inteligir.com/privacy`.
   Submit for review; § 7 installs what the store approves.

## 7. After

- **The download.** Passing: the site's Download button downloads this
  version's `Inteligir-arm64.dmg`, and the app from it opens from Finder with
  no warning beyond macOS's downloaded-from-the-internet notice.
- **The update.** On a Mac running the previous release, Settings › About ›
  Check for Updates. Passing: it finds `<version>`, Download and Restart each
  take a click, and the app comes back as `<version>` with the library as it
  was.
- **The extension.** Once the store approves this upload, install it from
  `chromewebstore.google.com/detail/<EXTENSION_ID>` in a browser with no dev
  build loaded. Passing: chrome://extensions shows `EXTENSION_ID`, and the
  toolbar button saves the page into the released app.
- **npm.** Passing: `npm view inteligir version` and
  `npx -y inteligir@<version> --version` both print `<version>`.
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
- **The Mac app or the CLI**: a patch version through this whole runbook. All
  three manifests move with it, but the phone's build may stay behind; its
  JavaScript hotfixes then branch from the tag of the build TestFlight serves.
