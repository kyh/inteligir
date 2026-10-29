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
4. Commit both, and release the app from that commit: the app writes
   `allowed_origins` from `EXTENSION_ID` at every launch
   (`apps/cli/src/desktop/native-hosts.ts`), so an app built before the swap
   refuses the store's extension. Every later upload is § 6's.

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

Four scenarios serve real pages from the machine's own private address
(`link-capture`, `library-integrated`, `import-integrated`,
`phone-fill-integrated`), and skip with "no usable LAN address" on a machine
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
none of the resources (`apps/desktop/scripts/package.ts` names them) and
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

- **Signed and notarized, the bundled node and git included.**

  ```sh
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign --verify --strict --verbose=2 "$app/Contents/MacOS/node"
  codesign --verify --strict --verbose=2 "$app/Contents/Resources/git/bin/git"
  spctl --assess --type execute --verbose=4 "$app"
  xcrun stapler validate "$app"
  ```

  Passing: the three `codesign` runs say `valid on disk` and
  `satisfies its Designated Requirement`, `spctl` says `accepted` with
  `source=Notarized Developer ID`, and `stapler` says
  `The validate action worked!`.

- **Sign in with Claude, for real.** On a Mac user signed out of both agents (a
  spare macOS user keeps your own sign-ins), open the app from Finder and
  choose Sign in with Claude, in `/welcome`'s agent step or Settings › Agent.
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
- **A connector through the browser.** With a real Notion account, Settings ›
  Connectors › Notion while Claude is the default agent. Passing: the browser
  asks Notion to approve, the row turns connected, and a new action asked to
  list your Notion pages calls a Notion tool and lists them. Make ChatGPT the
  default in Settings › Agent and repeat: the same.
- **A connector added outside the app.** With the bundled binary,
  `"$(find "$app" -type f -perm +111 -name claude | head -1)" mcp add --scope user <name> -- <command>`
  for any stdio server. Passing: Settings › Connectors lists it, and a new
  action asked which tools it has lists that server's, with nothing set in the
  app.
- **A quit leaves no agent running.** Start an action on ChatGPT that runs a
  long command (ask it to run `sleep 600` in a shell), and Quit while it runs.
  Passing: within 15 seconds of the window closing, `pgrep -fl Inteligir.app/`
  and `pgrep -fl 'sleep 600'` print nothing. Make Claude the default in Settings ›
  Agent and repeat: the same.
- **Dictation is the Mac's.** Press fn twice in the ⌘K composer and speak,
  then type. Passing: the words land once, at the caret; typing carries on
  after them; Enter while dictation is live does not send; the Edit menu shows
  Start Dictation…; and dictating into a note behaves the same.
- **An earlier install's actions start over once.** With the previous release
  installed, signed in in two libraries, the one in the Inteligir folder of your
  home and one elsewhere, each holding an action, install this build over it,
  open it from Finder and open each library with File › Open Library…. Passing:
  - The library in the Inteligir folder of your home opens signed out with no
    actions. Signing in again in Settings › Account brings no action back, and
    the account lists the Mac's earlier sign-in beside its new one.
  - The other library opens still signed in with no actions, and its own log,
    `~/.inteligir/vaults/<its hash>/logs/server.log` (Settings › Advanced › Show
    log), has the `[db]` line saying the database was replaced.
- **An earlier library opens as it is.** The same install, over a library the
  previous release kept, with a few notes and a comment. Passing: the window
  opens on the grid with every note a card and nothing rewritten on disk
  (`git -C <library> status` is clean), and the commented passage shows a
  dotted underline.
- **Covers.** Save a link to a long article. Passing: its cover under
  `assets/covers/` is a JPEG at most 640 px wide (`sips -g pixelWidth`), and a
  page whose picture is a PNG with transparency keeps a PNG. The grid's cards
  draw their pictures from `/vault/thumb` (Web Inspector's network panel), they
  scroll smoothly at 5,000 items, and the data folder's `thumbs/` stays under
  256 MB.
- **Real sites.** Save a YouTube video, an X post, a Spotify track, a paywalled
  article, a Wikipedia page and a long article. Passing: each fills in with its
  title, site, cover and text, and opens rich rather than Raw.
- **Networks.** Passing, each:
  - Behind a TLS-inspecting proxy whose root is only in the Keychain, saving a
    link still fills it in.
  - A page on your home network (a NAS or the router's own page) fills in when
    its own address is the link you saved.
  - A public test page that redirects to the router's address, and one whose
    `og:image` names a `192.168.x.x` address, save with the page's text, the
    first saying the page pointed at an address on your own network, and a
    network monitor on the router or the Mac shows no request reaching the
    router.
  - `http://localhost:3000` is kept as a link with the sentence saying an
    address on this Mac isn't read.
- **Restart.** Quit while a save is filling in, and open the app again.
  Passing: the item fills in. Paste 20 links at once. Passing: all fill in, and
  the ones still named by their address take their pages' titles; one opened
  while it was still filling in stays open through its rename and shows its
  article.
- **Keep a copy of the page.** On a saved link. Passing: the copy opens in the
  item's view, and Web Inspector shows its frame makes no request.
- **PDF.** A PDF item. Passing: it opens full size in WebKit's own viewer (the
  asset route answers it with no sandbox), with zoom and text selection, and
  Open in Preview works.
- **Media.** An `.mp4`, a `.mov` and an `.m4a` item. Passing: each plays,
  seeks and scrubs in the item's view, which means AVFoundation's `bytes=0-1`
  probe was answered 206 and the media token rode its range requests. Web
  Inspector's network panel shows whether those requests carried
  `Sec-Fetch-Site`; either way they are answered. A `curl` of the same asset
  URL with the `m` token and no cookie answers 401.
- **A long article.** Open a saved article of more than 300 blocks (a long
  Wikipedia page). Press ⌘F, find a word near its end, and Return. Passing:
  the match lands centred and holds still. Scroll back up to the top with the
  trackpad. Passing: the text moves only as far as you scroll, with no leap.
  Choose Export as PDF. Passing: the PDF holds the article's last paragraph, and
  no page in it is blank. Drag a block past the 100th one down the note.
  Passing: the dragged block stays in sight the whole way. Hover a table that
  ends at the 100th block. Passing: its add-row bar shows and adds a row.
- **Big files.** Passing: a 50 MB file dropped in Finder shows "Only on this
  Mac" in Info, and sync stays green; twenty 8 MB PDFs reach the online library
  in several pushes; a synced 9 MB file grown past 10 MB on one Mac shows in
  Deleted on a second Mac and on the iPhone, and restores there as its 9 MB
  version.
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
- **A real Raindrop export.** Settings › Library › Import from Raindrop… with
  the owner's own CSV backup (Raindrop's Settings › Backups), from an account
  with nested collections, tags, favourites and highlight notes. Passing: the
  file chooser opens, the summary's counts match Raindrop's, Import fills the
  library with the sidebar's progress row counting up, each highlight lands on
  its passage once its page fills (the synthetic fixture's reading of the
  highlights cell, notes and colours, is what this proves), and dead links
  keep theirs under `## Highlights`. A 5,000-link import keeps the window
  responsive and sync green. The scrubbed export then replaces the synthetic
  fixture in `apps/cli/src/server/imports/test-support/fixtures`.
- **Tidy my library**, with Claude and then with ChatGPT, over a new library.
  Passing: the four Unsorted examples are filed and tagged as the starter
  `AGENTS.md` says, and Undo changes puts them back. With three items selected,
  "Summarize these into a note" writes one note naming them.
- **Scale.** On a generated library of 20,000 to 50,000 items, relaunch.
  Passing: the grid's first paint is under about 2 s, and the boot line in
  `server.log` reports the reads it skipped by fingerprint. A library in iCloud
  Drive with Optimize Mac Storage on downloads no placeholder at boot.
- **The privacy text** matches what a network monitor shows during a save:
  the page, its cover, the oEmbed address for the sites docs/privacy.md names,
  and nothing else.
- **Words.** Passing: no "vault", and no "notes" meaning the whole library,
  across the window, the File menu, the dialogs, the updater's prompt, the
  first run and the iPhone's home screen.
- **The browser's door.** After the app's first launch,
  `~/.inteligir/native-host/inteligir-native-host` exists, and each installed
  browser's `NativeMessagingHosts` folder (Arc's own and Chrome's, for Arc)
  holds `com.inteligir.desktop.json` naming it.

### The browser extension

Load `apps/extension/.output/chrome-mv3-store-unpacked` with Developer mode on
in Chrome, Arc, Brave and Edge, the released app installed and its first run
finished.

- **The id.** Passing: chrome://extensions shows `EXTENSION_ID`
  (`packages/contract/src/browser/extension-identity.ts`), and all four
  `NativeMessagingHosts` folders hold `com.inteligir.desktop.json`.
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
- **The app closed.** Quit Inteligir and Save. Passing: the app opens behind
  the browser and the popup says saved within 30 s. Before the app's first run
  has finished, Save brings the app forward and says to finish setting up.
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
