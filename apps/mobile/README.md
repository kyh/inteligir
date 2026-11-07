# @repo/mobile — the inteligir phone

A full editor over the phone's own replica of the account's library, as the
Mac is: every item, block, folder and highlight is in a SQLite file on the
phone, so the Library lists, searches and opens offline, and every write
queues with its base in the replica's outbox until the account's library cell
takes it. The phone runs the same engine the Mac's window runs
(`@repo/library-replica`), over expo-sqlite, reaches the Worker only through
`/v1` (`@repo/contract`), edits an item in the editor page
(`@repo/mobile-editor`, behind `@repo/editor-bridge`), and asks the account's
built-in agent when online, drawing its conversations from
`@repo/agent-panel`.

Expo + expo-router; the runtime the screens use is composed platform-free
(`src/lib/compose-runtime.ts`), so the scenario suite runs it under node.

## Layout

```
src/
  lib/          the composition root (compose-runtime.ts, platform-free; app-runtime.ts,
                its binding to the device), the replica's SQL over expo-sqlite and over
                node's sqlite, phone-db.ts's own tables, the /v1 transport, the screens'
                hooks over the library, backup-exclusion.ts and http-cache.ts over the
                modules of those names, the native modules this app carries, and
                palette.ts, the colors a prop takes as a value, with theme.ts's useTheme
                over the system's scheme
  credential/   the device credential at rest, in the Keychain (expo-secure-store)
  login/        signing this phone in to an account
  files/        the library's files by their hash: pinned in Documents or cached, with
                their thumbnails (expo-file-folders.ts and expo-thumbnail.ts the native halves)
  editor/       the @repo/mobile-editor page in a WebView, the phone answering its bridge:
                an item's editor over the replica's ops, and the headless page that reads a
                shared page and merges a block two devices changed
  annotations/  an item's highlights, their notes and replies, in the sheet
  items/        saving a link, a thought, a new note or a photo, what a share hands over,
                the inbox that saves it (reading the page on the phone), and an item's Info
  library/      the Library's query by scope, kind and search, its cards, and what waits
                to be sent
  ui/           controls the screens share
  styles.css    the classes every screen writes: Tailwind's utilities over the palette,
                compiled for React Native by nativewind (The look, below)
  app/          expo-router screens: index.tsx is the Library, item/ an item in the editor,
                view/ a file full size, agent/ the agent's conversations; _layout.tsx holds
                the splash, the share provider, the headless page and the route guard, and
                +native-intent.ts lands the share extension's handoff on the Library
plugins/        with-editor-page.js: the built page into the app bundle
metro.config.js withNativewind, and postcss.config.js Tailwind's PostCSS plugin: the
                sheet's two compilers; nativewind-env.d.ts gives `className` its types
```

## The look

The screens are styled with nativewind, as kyh/init's phone is: a screen writes
`className` with Tailwind's utilities, and Metro compiles `src/styles.css`
through PostCSS (`postcss.config.js`) and then react-native-css
(`withNativewind` in `metro.config.js`). Metro resolves every import of
`react-native` to react-native-css's own `View`, `Text`, `Pressable`,
`TextInput`, `Image`, `ScrollView`, `FlatList`, `KeyboardAvoidingView` and
`ActivityIndicator`, which read their `className` (a list's
`contentContainerClassName` too); what it does not wrap, `SafeAreaView`, a
WebView, `Modal`, `RefreshControl` and the navigator, takes a `style`. The
sheet is imported once, by `app/_layout.tsx`.

- **The palette is variables.** `styles.css` declares each token (background,
  foreground, card, card-foreground, primary, primary-foreground, muted,
  muted-foreground, border, input, destructive) light at `:root` and dark under
  `prefers-color-scheme: dark`, and `@theme inline` maps them to
  `bg-card`, `text-muted-foreground`, `border-border` and the rest, so the
  system's scheme recolours every screen with no `dark:` in it.
- **A value outside a class reads `lib/palette.ts`**: a navigator's options, an
  `ActivityIndicator`, a safe area's or a WebView's background, through
  `useTheme()`; a field's placeholder is a `placeholder:` class. It holds only
  the tokens read that way, at the sheet's values, and `src/styles.test.ts`
  compiles the sheet as Metro does and holds the two equal in both schemes, so
  such a color changes in both or the suite fails.
- **A rem is the web's.** react-native-css reads every rem at the sheet's
  `:root` font size, 16px, so Tailwind's spacing and radii are the web's:
  `p-4` is 16, `rounded-lg` 8. The sheet imports Tailwind's theme and preflight
  layered and its utilities unlayered, as NativeWind 5 sets a sheet up. The type
  sizes are the phone's own, named by their px (`text-12` to `text-30`), each a
  size alone, and a reading line's height is a `leading-*` class beside it.
- **A multi-line field is padded `pt-*` and `pb-*`.** `py-*` compiles to
  `paddingBlock`, and iOS gives a multi-line `TextInput` with no `paddingTop`
  its own 5; the sheet's suite fails on one.
- **A class is written out whole**, never assembled from parts, since Tailwind
  makes only the classes a source spells (`ui/text-button.tsx` picks its size
  from a table of them).

## The replica

`openExpoReplicaSql` (`src/lib/expo-replica-sql.ts`) is the engine's SQL port
over one expo-sqlite file in Documents, opened in WAL: every transaction is an
exclusive one (`withExclusiveTransactionAsync`, a connection of its own) behind
one JS write lock, every value is bound and every prepared statement is
finalized in a `finally`. The library's tables are the cell's own schema,
versioned by its `meta.schema` row, and the phone's own (`phone_files`, the
file cache's use and each file's type, and `phone_staged`, the type of each
file waiting to be sent) are one step in `src/lib/phone-db.ts`. A sign-in wipes the
file and starts it over, so a credential over an empty database pulls the
library afresh.

A write is the replica's: an item page writes ops with their bases, a save, a
new note, a photo, a move to Deleted and a highlight go through the engine's
verbs, and each lists at once and waits in the outbox until the cell takes it.
A `CONFLICT` settles through the block merge, which runs in the headless page
(`src/editor/headless-page-host.ts`), since the editor's diff3 lives only
there. What waits shows under the Library (`src/library/unsent-banner.tsx`),
and a sign-out with anything unsent asks first.

The account's socket is the replica's, dialed by ticket, never by a header:
the foreground holds it, the background suspends the replica and closes it,
and a resume or a reconnect pulls and sends (`src/lib/app-runtime.ts`).

## Files

A file is kept by its hash (`src/files/file-cache.ts`), fetched once however
many screens ask: a staged upload, and a file a live note of the person's
embeds, are pinned in Documents, out of the device backup; every other file is
in `Paths.cache`, stamped as used and dropped oldest first past the cap, and a
file over 512 KB lists from a 320 px thumbnail made once. A picture past what a
phone may decode shows the card's placeholder. A screen waiting on a file it
could not reach gets it once the library answers again
(`src/files/watch-file.ts`). An upload whose write landed is kept as a fetched
file is. A screen draws a file as an item's own, its card's cover or its
viewer's original, and the item page draws one a note
names from the cache over its bridge (`readFile`), as the type it was kept or
served as, and keeps one pasted into the text through the replica
(`keepFile`). A sign-out moves the cache's generation,
so a download begun before it lands nothing.

## Sharing to the phone

The share extension hands a page, a link or text to the app, which reads it
(`src/items/share-payload.ts`) and saves it (`src/items/share-save.ts`): a
page is fetched by the phone, each redirect judged by its spelling
(`src/items/page-fetch.ts`), read in the headless page by the library's own
reader and saved read, with its cover; a page it cannot read now, offline
among them, a link that leads elsewhere, or a page it read no text from, is
saved as its link, which the cloud reads once it lands. Words shared beside the
link are kept either way: as the item's
note, or as an unread link's title when they are short enough to name it.

## The agent

The agent is the account's: the phone lists the same conversations as the
Mac and draws a thread's events, approvals and the reply being written from
`@repo/agent-panel`, natively (`src/app/agent/`). Asking about an item sends
it as the view's context. A send and an approval need a connection and say so
rather than queue, since a turn runs in the cloud.

## The sign-in seam

A phone joins an account the way the desktop does: the account's own email
and password, sent once as `account.signIn`, answered with this
phone's own `igd_…` device credential. The login store (`src/login/login-store.ts`) posts the row and keeps the
answer in the Keychain adapter; the password is held nowhere on the phone: it
crosses the wire once and only the device credential remains, revocable from
the account's Devices page. A refusal on the wire and a Keychain that cannot
write all land in the one store the screen reads, so each is shown rather
than dropped; a credential the Keychain could not keep is signed out before
the error shows.

A sign-in is one library (`src/lib/compose-runtime.ts`): its replica, its
`/v1` client and query helpers, its files and its previews, made together and
closed together. An `unauthorized` a pass of the replica hears ends it for all
of them and takes the rows, the files and the credential, which stays only
when the copy would not go, so the next launch meets the same refusal; the
sign-in screen says this device was signed out from the session's notice. A
refusal on any other call, a file's or the agent's, waits for the replica's
next pass. A `client-outdated` ends it as `outdated` and wipes nothing, so the
next build resumes from what the phone holds. Which screens exist is the ROUTE
GUARD's answer (`Stack.Protected` in `app/_layout.tsx`), never a per-screen
branch, and a cold launch is `restoring` until the Keychain read ends, so the
sign-in form never flashes over a device that is signed in.

## Verified vs device-side

- **Verified here** (`pnpm --filter @repo/mobile typecheck` + `test`, and the
  repo-wide `pnpm verify`): the composition's restore, sign-in, sign-out,
  revocation and outdated build over a fake cell, the phone's own tables over
  `node:sqlite`, the credential and its Keychain accessibility (over a stand-in
  Keychain), the sign-in store, the file cache (pinning, the cap, the
  thumbnail, the generation), the editor page's native end (every frame kind
  to its port, a foreign document's, another load's and a malformed frame
  dropped, a flush held until the page answers, the load policy), the item
  page's ports, the headless page's host, the annotation edits, the share
  payload and the share's read, and the Library's query. Unit tests, no device.
  `tools/e2e/src/scenarios/phone-offline-edit.ts`, `phone-save-hosted.ts`,
  `phone-annotations-hosted.ts` and `phone-file-ops-hosted.ts` run the same
  composition under node against a real Worker, beside a second device, and
  `phone-editor-page.ts` loads the built page from `file://`.
- **The store config** (`src/app-config.test.ts`): it asks Expo's
  own CLIs for the resolved config and the autolinked modules, and holds the
  config to what App Store Connect judges — the marketing version is the
  package's, the encryption answer is given, no permission carries an Expo
  default purpose string, and every required-reason API a linked module's
  privacy manifest declares is declared by the app's. A new native module that
  brings a manifest or a permission fails it until `app.config.js` says why.
- **The stylesheet** (`src/styles.test.ts`): it compiles `src/styles.css` with
  the screens' own classes, Tailwind under PostCSS and then react-native-css as
  Metro does, and holds every token to one light and one dark value, those a
  prop reads to `lib/palette.ts`, each color class to its token's variable, a
  rem to 16px, a size class to a size alone, a line-height and a placeholder
  class to what they draw, and no multi-line field to `py-*`.
- **The bundle**: `pnpm build` runs `expo export --platform ios`, so every
  `pnpm verify` and CI run compiles the phone's JavaScript to Hermes bytecode,
  and the stylesheet into it, offline, on Linux and macOS alike.
- **Needs the owner's device / simulator** (no headless Expo boot in CI): the
  app actually booting, the held splash and the route guard's redirects, the
  Keychain, expo-sqlite and its full-text search on the device, the backup
  exclusion, the file cache and staged photos, the headless page's merge and
  read, the resume and the reconnect, the socket's upgrade from the device and
  a Mac's edit arriving on it, a share read on the phone, the agent, a live
  sign-in, an EAS Update landing, the editor on a real WebKit, and how the
  screens look in light and dark. Each is a check with how to run it and what
  passing looks like in `docs/releasing.md` § 5, run on every release's
  internal build; a native module a development build predates needs that
  build rebuilt (`pnpm --filter @repo/mobile ios`).

## Dev

```bash
pnpm --filter @repo/mobile ios                                              # builds the editor page, then the app
pnpm --filter @repo/mobile dev                                              # against the production cloud
EXPO_PUBLIC_CLOUD_URL=http://localhost:5174 pnpm --filter @repo/mobile dev  # against `pnpm dev:web`
```

The item screen's editor is `@repo/mobile-editor`'s built page, carried in the
app bundle by `plugins/with-editor-page.js`, so it changes only with a new
native build: `pnpm --filter @repo/mobile ios` builds the page first, and
`pnpm --filter @repo/mobile editor-page` rebuilds it alone. Metro serves the
JavaScript alone; there is no dev server for the page (its CSP refuses the
script a Vite dev page injects), and Safari's Web Inspector reaches it in a
development build (`webviewDebuggingEnabled`).

The stylesheet is compiled from the classes Tailwind found in `src/` when Metro
last transformed it, so a class just added that draws nothing under a running
`dev` needs `pnpm --filter @repo/mobile dev --clear`; `pnpm --filter
@repo/mobile test` compiles it the same way without a device.

Unset, the phone talks to the production origin in every build
(`PRODUCTION_CLOUD_ORIGIN` in `@repo/contract/cloud/origin`, which the extension
reads too and the desktop spells again in `apps/desktop/src-tauri/src/cloud.rs`
under a repo guard).
`EXPO_PUBLIC_CLOUD_URL` is read once, at bundle time, through
`src/lib/cloud-url.ts`: Metro inlines it, so a store build carries no value and
cannot point anywhere else. A value that is not an absolute http(s) URL throws
rather than guessing, and there is no LAN-host fallback: the Worker's dev
server binds localhost, so an origin derived from the Metro host could never
answer a phone. The simulator shares the Mac's localhost; a physical phone
needs a URL it can reach.

## Shipping

The phone ships through EAS Build to TestFlight, iPhone only, as one of the
release's three artifacts: `docs/releasing.md` is the release's order, its
gates and the owner's device checks, and this section is the phone's own half.
The credentials (the distribution certificate, the provisioning profile, the
App Store Connect API key) live on EAS, never in this repo, and build numbers
are EAS's (`appVersionSource: remote`, `autoIncrement`), so no commit bumps
one. The marketing version is `package.json`'s, the product version the Mac
app and the extension carry (`tools/repo-guards/src/release-versions.test.ts`).
`eas.json` names the node and pnpm the repo is checked with, and no
`.easignore`: EAS falls back to `.gitignore`, which keeps `.release/` and
every `.env*` out of the upload. The editor page is gitignored build output,
so EAS builds it in the `eas-build-post-install` hook, and `testflight` builds
it first on this machine too, since the fingerprint below is taken on both.

```bash
pnpm testflight:mobile   # eas build --platform ios --profile production --auto-submit
pnpm hotfix:mobile       # eas update to the production channel: a JS-only fix
```

### One-time setup (owner)

1. `pnpm --filter @repo/mobile exec eas login`, then
   `pnpm --filter @repo/mobile exec eas init`. EAS cannot write a dynamic
   config, so commit the owner and project id it prints into `easProject` in
   `app.config.js`; that one value also points EAS Update at the project.
2. The first `pnpm testflight:mobile` logs into the Apple team that signs the
   desktop app and lets EAS create and keep the certificate, the profile and an
   App Store Connect API key. Its submit creates the App Store Connect record
   for `com.inteligir.mobile`.
3. Commit that record's id as `submit.production.ios.ascAppId` in `eas.json`,
   so later submits ask nothing.
4. In App Store Connect › TestFlight, create the internal group `Owner` and add
   yourself, and the external group `Cohort`. Every build reaches `Owner`
   first, and `Cohort` only once it has passed there (Per release, below).
5. Fill TestFlight's Test Information once: a beta description, a feedback
   email you read, `https://inteligir.com/privacy` as the privacy policy, and
   the Beta App Review sign-in below.

If EAS's install fails under pnpm 12, the fallback is a custom build,
`.eas/build/production.yml`, that installs with
`pnpm install --frozen-lockfile --filter @repo/mobile...`.

### Beta App Review account (one-time, owner)

A build going to testers outside the team waits for Apple's Beta App Review,
and the reviewer needs a sign-in that never expires into an account that
already holds items: the phone signs in, never signs up.

1. Mint a production invite with a fresh code, the recipe in
   `apps/web/README.md` § Auth:
   ```bash
   pnpm --filter @repo/web exec cf d1 query 005d0e52-f102-4298-8da9-492b672ed00f \
     --sql "INSERT INTO invite_code (code) VALUES ('<fresh code>')"
   ```
2. Sign up with it at `https://inteligir.com/app/sign-up`: an address you
   read, and a long password.
3. Give the account a few items once: open `https://inteligir.com/library`
   signed in as the review account, save a link, write a note and add a
   picture. Passing: the internal build, signed in as the review account,
   lists them.
4. Keep the address and the password in `.release/` (gitignored), and enter
   them as Test Information's Beta App Review sign-in, with these notes:
   > Sign in with the account above; its items are already there. Everything
   > reads and edits on the phone alone, offline included: a link saved
   > offline shows "Waiting to be read" until the phone is back online, and
   > the page is then read in the cloud. The agent needs a connection.
5. Each review signs in as a new device, and an account holds 20: revoke the
   old review devices at `https://inteligir.com/app/devices` before the next
   submission.

### Per release (owner)

`docs/releasing.md` says when each step runs: steps 1 to 3 before anything is
published, 4 to 6 once the Mac app and the extension are out.

1. **Pre-flight.** `docs/privacy.md` names every flow the phone makes (each
   `/v1` route it calls is a row of its table, and Expo's update check is
   named), and the release commit is green in CI.
2. **Build.** `pnpm testflight:mobile` from the release commit. Passing:
   App Store Connect's processing email carries no warning (a missing purpose
   string, an undeclared required-reason API). A warning is a fix and a new
   build, never a waiver.
3. **Internal.** Install the build from the `Owner` group on your iPhone, from
   TestFlight and never as a development build, and run `docs/releasing.md` §
   5's iPhone checks on it.
4. **Cohort.** Add the build to the `Cohort` group with its What to Test, in
   the words a tester reads (never git, commit, remote, repo, terminal, CLI,
   PATH or MCP):

   > Sign in with your Inteligir account's email and password. Your library
   > arrives and opens offline. Save a link from the share sheet, edit a note
   > here and see it on your Mac, and add a photo. Take a screenshot to send us
   > feedback.

   Each version's first build for the group goes through Beta App Review
   before any tester sees it, usually within a day; later builds of that
   version usually skip it.

5. **Invite.** Per-tester email invites or one public link, the owner's call at
   this step. Either way a tester needs an account first, which takes an
   invite code (`apps/web/README.md` § Auth): the phone signs in, never signs
   up.
6. **Upkeep.** A build expires 90 days after upload, so a cohort still testing
   then needs a new build of the same version (`pnpm testflight:mobile` from a
   branch off the release tag, then step 3). Build numbers are EAS's:
   `pnpm --filter @repo/mobile exec eas build:version:get --platform ios`
   prints the latest, and no commit carries one.

### Hotfixes

A fix that touches only JavaScript ships as an EAS Update, never a new build:
`pnpm hotfix:mobile` bundles on this machine and publishes to the `production`
channel the store builds listen on. An update reaches only builds whose native
code fingerprints the same (`runtimeVersion: { policy: "fingerprint" }`), so a
change to a native module, a config plugin or the SDK needs
`pnpm testflight:mobile` instead. The script clears `EXPO_PUBLIC_CLOUD_URL`
because, unlike `eas build`, `eas update` bundles with this shell's environment,
and a leftover local origin would ship to every phone. The editor page is
native too: it ships in the binary, so `fingerprint.config.js` adds its build
to the fingerprint and `hotfix` builds the page before taking it. An update
bundled beside a changed page matches no installed build and reaches nobody;
a page change needs `pnpm testflight:mobile`, since the bridge between the
page and the JavaScript breaks freely between releases. The fingerprint also
covers the app config, `version` included, so an update bundled after a
version bump reaches nobody either: a hotfix is published from a branch off
the tag of the build TestFlight serves (`docs/releasing.md` § Hotfixes).
