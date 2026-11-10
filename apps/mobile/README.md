# @repo/mobile — the inteligir phone

The account's library on the phone, online first: the cloud holds it, and the
phone reads it through `/v1` (`@repo/contract`) with TanStack Query, whose
cache it keeps between launches, so what it last read shows offline. A save,
a photo and the agent need a connection and say so; only a share from another
app waits on the phone, in its outbox, until the library can be reached. It
edits a note live in the editor every device draws, `@repo/editor` in an Expo
DOM component, and draws the built-in agent's conversations from
`@repo/agent-panel`.

Expo + expo-router; the runtime the screens use is composed platform-free
(`src/lib/compose-runtime.ts`), so the scenario suite runs it under node.

## Layout

```
src/
  lib/          the composition root (compose-runtime.ts, platform-free; app-runtime.ts,
                its binding to the device), the /v1 transport, the screens' queries
                over the library (library-hooks.ts), backup-exclusion.ts over the
                module of that name, the native module this app carries, and
                palette.ts, the colors a prop takes as a value, with theme.ts's useTheme
                over the system's scheme
  auth/         the phone's sign-in: Better Auth's Expo client, its session cookie in the
                Keychain (expo-secure-store)
  login/        signing this phone in to an account, or making one with an invite code
  files/        the library's files by their hash, cached with their thumbnails
                (expo-file-folder.ts and expo-thumbnail.ts the native halves)
  editor/       an item's note: page/ is the DOM component, @repo/editor in a web view
                (note-page.tsx, its host and its content policy), and beside it the
                native half: the page's actions over the library, the web view's load
                policy, and a leave's ask
  items/        saving a link, a thought, a new note or a photo, what a share hands over,
                the outbox that keeps a share until it lands, the inbox that hands it
                there, and an item's Info
  library/      the Library's page of a listing by scope, kind and search, its cards, and
                the saves waiting
  ui/           controls the screens share
  styles.css    the classes every screen writes: Tailwind's utilities over the palette,
                compiled for React Native by nativewind (The look, below)
  app/          expo-router screens: index.tsx is the Library, item/ an item in the editor,
                view/ a file full size, agent/ the agent's conversations; _layout.tsx holds
                the splash, the query cache, the share provider and the route guard, and
                +native-intent.ts lands the share extension's handoff on the Library
metro.config.js withNativewind, and postcss.config.js Tailwind's PostCSS plugin: the
                sheet's two compilers; nativewind-env.d.ts gives `className` its types,
                and inline-fonts.js writes the note page's fonts into its sheet
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

## The library and its cache

Every screen reads through TanStack Query over the contract's procedures
(`src/lib/library-hooks.ts`): the Library a page of `library.listing.page` at a
time, its search the same row's `words`, an item `library.items.get`, the
folders `library.listing.scopes` and a link's names `library.listing.titles`.
The cache is kept in expo-sqlite's key-value store between launches
(`@tanstack/react-query-persist-client`), out of the device backup, and a
build that changes starts it over; a file's address and a write are never
kept. Its online state is the network's and its focus the app's
(`src/lib/app-runtime.ts`), so a screen asks again when either comes back.

A write goes at once and says "Needs a connection" when it cannot. A note's
body is the exception: its page edits the note's live document over the
note's own socket, which it dials on a ticket the phone fetched, and with no
connection draws what the phone last read of it, read-only.

The account's socket, dialed by ticket, never by a header, says what each
write moved, and the queries reading it ask again; an open socket asks
everything again, since a write may have landed while none was open. The
foreground holds it, the background closes it.

## Files

A file is kept by its hash (`src/files/file-cache.ts`), fetched once however
many screens ask, in `Paths.cache`, which iOS keeps out of the backup and may
purge; a file over 512 KB lists from a 320 px thumbnail made once. A picture
past what a phone may decode shows the card's placeholder. A screen waiting on
a file it could not reach asks again once the phone is back online. A file the
phone sends up is kept as a fetched file is, so it never downloads what it
sent. A screen draws a file as an item's own, its card's cover or its
viewer's original, and the note page draws one a note names from the cache
through its `readFile` action, as the type it was kept or served as. A sign-out moves the cache's generation, so a download begun
before it lands nothing.

## Sharing to the phone

The share extension hands a page, a link or text to the app, which reads it
(`src/items/share-payload.ts`) and keeps it in its outbox
(`src/items/share-outbox.ts`) before the first call, then sends it: a page or
a link is saved as its link, which the cloud reads once it lands, and text
alone as a thought. Words shared beside the link are a new item's note. A
share the cloud cannot be reached for waits, through a relaunch, and goes once
the phone is back; the Library says how many saves are waiting
(`src/library/unsent-banner.tsx`), and a sign-out with any asks first.

## The agent

The agent is the account's: the phone lists the same conversations as the
Mac and draws a thread's events and approvals from `@repo/agent-panel`,
natively (`src/app/agent/`), and the reply being written as the account's
socket carries it (`src/lib/thread-previews.ts`). Asking about an item sends
it as the view's context. A send and an approval need a connection and say so
rather than queue, since a turn runs in the cloud.

## The sign-in seam

A phone joins an account with a Better Auth session, as the site does: the
account's own email and password, or a new account with an invite code through
the cloud's one sign-up door, sent once through Better Auth's Expo client
(`src/auth/phone-auth.ts`, bound in `src/lib/app-runtime.ts`). The client keeps
the session cookie in the Keychain, this device only, while unlocked
(`src/auth/keychain-storage.ts`), and every `/v1` call carries it with the
app's scheme as its origin and no shared cookie jar (`src/lib/phone-transport.ts`).
The password is held nowhere on the phone: it crosses the wire once and only
the session remains, which Settings › Account lists as iPhone and can end. Each launch and each return to the front asks Better Auth for the
session, which keeps a phone in use signed in. A refusal on the wire and a
Keychain that cannot write all land in the one store the screen reads
(`src/login/login-store.ts`), so each is shown rather than dropped; a session
the Keychain could not keep is signed out before the error shows.

A sign-in is one library (`src/lib/compose-runtime.ts`): its `/v1` client and
query helpers, its saves, its shares and its previews, made together and
closed together. An `unauthorized` any of its calls hears, or a session Better
Auth no longer holds, ends it for all of them and takes the cache, the files,
the shares and the session, which stays only when the copy would not go, so
the next launch meets the same refusal; the sign-in screen says this device
was signed out from the session's notice. A `client-outdated` ends it as `outdated` and clears
nothing, so the next build resumes from what the phone holds. Which screens exist is the ROUTE
GUARD's answer (`Stack.Protected` in `app/_layout.tsx`), never a per-screen
branch, and a cold launch is `restoring` until the Keychain read ends, so the
sign-in form never flashes over a device that is signed in.

## Verified vs device-side

- **Verified here** (`pnpm --filter @repo/mobile typecheck` + `test`, and the
  repo-wide `pnpm verify`): the composition's restore, sign-in, sign-out,
  revocation and outdated build over a fake cell, what the socket's frames ask
  again and what the cache keeps, the session's Keychain accessibility (over a
  stand-in Keychain), the sign-in over Better Auth's own client, what each
  `/v1` request carries, the sign-in store, the file cache
  (the thumbnail, the generation), the note page's actions over the fake cell
  (every answer JSON, a file's bytes base64, a refusal its words), its host
  (what native's props move, a leave's ask answered by where the note
  stands), its content policy and the web view's load policy, the share
  payload and the shares' outbox, and the Library's query. Unit tests, no
  device.
  `tools/e2e/src/scenarios/phone-offline-share.ts`, `phone-save-hosted.ts` and
  `phone-file-ops-hosted.ts` run the same
  composition under node against a real Worker, beside a second device, its
  sign-in a plain fetch on the Expo client's routes.
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
  and the stylesheet into it, and the note page's DOM bundle beside it
  (`dist/www.bundle`, one page and its one script), offline, on Linux and
  macOS alike.
- **Needs the owner's device / simulator** (no headless Expo boot in CI): the
  app actually booting, the held splash and the route guard's redirects, the
  Keychain, the kept cache and the shares waiting in expo-sqlite's key-value
  store, the backup exclusion, the file cache and photos, the resume and the
  reconnect, the socket's upgrade from the device and a Mac's edit arriving on
  it, a share from another app, offline and online, the agent, a live
  sign-in, an EAS Update landing, typing in a note on a real WebKit and
  keyboard, and how the screens look in light and dark. Each is a check with how to run it and what
  passing looks like in `docs/releasing.md` § 5, run on every release's
  internal build; a native module a development build predates needs that
  build rebuilt (`pnpm --filter @repo/mobile ios`).

## Dev

```bash
pnpm --filter @repo/mobile ios                                              # a development build
pnpm --filter @repo/mobile dev                                              # against the production cloud
EXPO_PUBLIC_CLOUD_URL=http://localhost:5174 pnpm --filter @repo/mobile dev  # against `pnpm dev:web`
```

A note's editor is a DOM component (`src/editor/page/note-page.tsx`), which
Metro serves beside the app's JavaScript, so an edit to it or to
`@repo/editor` reloads like any other; its content policy is a production
build's alone, since Metro's own scripts come from its server, and Safari's
Web Inspector reaches the page in a development build
(`webviewDebuggingEnabled`). On a physical phone, Metro's address over the
network is plain http, which is no secure context, so the page has no
`crypto.randomUUID` or `crypto.subtle` and the editor fails: run
`pnpm --filter @repo/mobile exec expo start --tunnel`, or use the simulator,
whose localhost is one.

The stylesheet is compiled from the classes Tailwind found in `src/` when Metro
last transformed it, so a class just added that draws nothing under a running
`dev` needs `pnpm --filter @repo/mobile dev --clear`; `pnpm --filter
@repo/mobile test` compiles it the same way without a device.

Unset, the phone talks to the production origin in every build
(`PRODUCTION_CLOUD_ORIGIN` in `@repo/contract/origin`, which the extension
reads too).
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
every `.env*` out of the upload.

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
and the reviewer needs a sign-in into an account that already holds items,
which lasts 60 days from its last use: the reviewer signs in, never signs up.

1. Mint a production invite with a fresh code, the recipe in
   `apps/web/README.md` § Invites:
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
   > Sign in with the account above; its items are already there. What the
   > phone last read opens offline; saving and the agent need a
   > connection. A link shared from another app while offline waits on the
   > phone until it is back online, and the page is then read in the cloud.
5. Each review signs in as a new session. An account keeps 20, a sign-in
   past that ending the one used longest ago, so old review sessions need no
   clearing before the next submission.

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
   > arrives, and what you last read opens offline. Save a link from the share
   > sheet, write a note on your Mac and read it here, and add a photo. Take a
   > screenshot to send us feedback.

   Each version's first build for the group goes through Beta App Review
   before any tester sees it, usually within a day; later builds of that
   version usually skip it.

5. **Invite.** Per-tester email invites or one public link, the owner's call at
   this step. Either way a tester needs an account first, which takes an
   invite code (`apps/web/README.md` § Invites): the phone signs in, never signs
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
and a leftover local origin would ship to every phone. The editor ships in
the update: its DOM bundle is exported beside the app's JavaScript, in one
chunk (`EXPO_NO_BUNDLE_SPLITTING`), so an editor fix is a hotfix too. The
fingerprint also
covers the app config, `version` included, so an update bundled after a
version bump reaches nobody either: a hotfix is published from a branch off
the tag of the build TestFlight serves (`docs/releasing.md` § Hotfixes).
