# Decisions: @repo/mobile

The phone: its editor page, its cache, its shares and its files, the agent, its
look, and how it ships.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Editor and dialect

- **THE PHONE'S EDITOR IS A VITE PAGE CARRIED IN THE BINARY: ONE CLASSIC SCRIPT
  IN A WEBVIEW, BEHIND A TYPED, NONCE-STAMPED BRIDGE** (owner decision).
  WKWebView loads no module script or `crossorigin` tag from `file://`
  (vitejs/vite#14483), so the build is one IIFE and fails on anything else
  (`apps/mobile-editor/vite/classic-page.ts`). The page ships in the bundle, so
  it loads with no network (`apps/mobile/plugins/with-editor-page.js`), and in
  the native fingerprint, so an EAS Update beside another page matches no
  install (`apps/mobile/fingerprint.config.js`). Rejected: a React Native
  renderer of the dialect (cannot edit, degrades what it does not model); Expo
  DOM components (a second compile of the editor, typechecked under the
  phone's TypeScript 6, not the editor's Vite, React Compiler and TypeScript 7).

- **NATIVE REACHES THE EDITOR PAGE ONLY THROUGH ITS DOOR, AND THE WEBVIEW IS ONE
  POLICY.** The door is installed non-writable on `window`, never a message
  event a child frame's `parent.postMessage` could forge, and every frame after
  `init` carries the nonce (`apps/mobile-editor/src/bridge/page-bridge.ts`). The
  wire breaks freely, since one binary ships both ends
  (`packages/editor-bridge/src/protocol.ts`); an item page's host reads the
  account's library and writes nothing
  (`apps/mobile-editor/src/item/item-host.ts`,
  `apps/mobile/src/editor/item-ports.ts`). The WebView loads the page and its
  frames, hands a followed web link to Safari and refuses the rest; its origin
  list admits every address, because the library hands what that list refuses
  to the OS before the policy runs (`apps/mobile/src/editor/editor-host.ts`).
  Every injected script ends `true;` and every frame is a string.
  `tools/e2e/src/scenarios/phone-editor-page.ts` loads the built page from
  `file://`.

- **THE PHONE'S ITEM PAGE IS READ-ONLY, DRAWN FROM THE BLOCKS THE PHONE
  HOLDS** (owner decision, until the phone's editor joins a note's live
  document). The page draws the item as the cloud holds it, or as the phone
  last read it while there is no connection, under the phone's words that
  editing on the phone is coming, and draws it again when the item's query
  moves or a name a link shows does (`apps/mobile/src/editor/item-ports.ts`,
  `apps/mobile/src/editor/use-item-editor.ts`,
  `apps/mobile-editor/src/item/item-page.tsx`). It dials no note, keeps no
  file and makes no note; a save, a photo and a share still save. Rejected:
  writing a note's blocks from the phone beside the live document (a second
  writer the note would have to merge); queueing edits offline (the cloud is
  the truth). Residual: a note's typing that moves no row leaves the phone's
  copy as it was until the next move of its row or a pull to refresh.

## Cloud, sync and accounts

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  The session and the login flow publish stores the screens subscribe to, so a
  revocation and a refused login show (`apps/mobile/src/lib/compose-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`). A sign-in is ONE library, its `/v1`
  client, query helpers, saves, shares and previews made together and closed
  together, so a revocation any of its calls hears ends it for all, once
  however many hear it, and a refusal heard under an earlier sign-in never
  ends the next. The route guard, never a per-screen branch, decides which
  screens exist (`Stack.Protected` in `apps/mobile/src/app/_layout.tsx`):
  signed in, the Library, an item, a script-less viewer of a file and the
  agent; signed out, the sign-in.

- **THE PHONE READS THROUGH TANSTACK QUERY, ITS CACHE KEPT BETWEEN LAUNCHES,
  AND HOLDS ITS SOCKET ONLY IN THE FOREGROUND.** Every screen reads the
  contract's procedures through `@orpc/tanstack-query`
  (`apps/mobile/src/lib/library-hooks.ts`), and the cache is persisted to
  expo-sqlite's key-value store (`@tanstack/react-query-persist-client` and
  `@tanstack/query-async-storage-persister`, pinned with
  `@tanstack/react-query` in `pnpm-workspace.yaml`), so what was last read
  shows offline; the client build is its buster, a file's address
  (`meta.persist: false`) and a write are never kept
  (`apps/mobile/src/lib/compose-runtime.ts`). Online is the network's state
  and focus the app's (`apps/mobile/src/lib/app-runtime.ts`). The account's
  socket says what each write moved, and the queries reading it ask again; an
  open socket asks everything again. The background closes it, since iOS
  suspends the app anyway. Rejected: the replica engine over expo-sqlite (a
  copy of the whole library, its outbox and its merge, for a premise that
  keeps the truth in the cloud); a mutation kept for later (a write offline
  says so, and only a share waits).

- **THE PHONE'S KEY-VALUE STORE IS OUT OF THE DEVICE BACKUP, AND ITS FILES ARE
  IN THE CACHE.** The store holds the kept cache and the shares waiting, so
  `apps/mobile/modules/backup-exclusion` keeps its folder out of the iCloud
  backup with its first write (owner decision): a restore onto another phone
  would send shares under nobody's sign-in (`apps/mobile/src/lib/app-runtime.ts`).
  A file is in `Paths.cache`, which iOS keeps out of the backup and may purge
  (`apps/mobile/src/files/expo-file-folder.ts`). A sign-in, a sign-out and a
  revocation clear the cache, the shares and every file, and the Worker's
  `no-store` keeps a file's bytes out of the system's HTTP cache; a relaunch
  keeps them.

- **A FILE'S BYTES ARE KEPT BY ITS HASH, FETCHED ONCE, IN THE PURGEABLE
  CACHE.** A file is downloaded once however many screens ask for it at once,
  and a cover's thumbnail is made from the bytes that crossed. A file the phone
  sent up is kept as it went, so the phone never downloads what it sent. Each
  file keeps the type it was sent as or the cloud served, which the item page
  draws a note's file by over the bridge
  (`apps/mobile-editor/src/item/item-host.ts`). A file over 512 KB lists from a
  320 px thumbnail made once. No cover is decoded past
  `FILL_LIMITS.coverMaxPixels`: one is drawn whole only when it is a small file
  whose header names a size within that, any other picture goes through the
  thumbnail, one at a time in the app's own process and measured by the decoder
  before it decodes, and one refused or that made no thumbnail shows the card's
  placeholder, since a few bytes can name a bitmap that kills the app on every
  launch (`apps/mobile/src/files/expo-thumbnail.ts`). Residual: a turned AVIF
  or HEIC, whose header nothing here reads, is drawn upright before the decoder
  measures it. A screen waiting on a file it could not reach asks again once
  the phone is back online (`apps/mobile/src/lib/library-hooks.ts`). A
  sign-out moves the cache's generation, so a download begun before it lands
  nothing (`apps/mobile/src/files/file-cache.ts`). Rejected:
  `expo-file-system/legacy` (its promise API is deprecated); a type read from
  the first bytes (no sniff names a recording, which WebKit then may not play).

- **THE PHONE SIGNS IN WITH A BETTER AUTH SESSION, KEPT BY ITS EXPO CLIENT IN
  THE KEYCHAIN, THIS DEVICE ONLY, WHILE UNLOCKED.** `expoClient` keeps the
  session cookie (`apps/mobile/src/auth/keychain-storage.ts`), and every
  procedure and the socket's ticket send it with the app's scheme as
  `expo-origin` and `credentials: "omit"`, so no shared cookie jar carries a
  second one (`apps/mobile/src/lib/phone-transport.ts`). A new account goes
  through the cloud's invite gate, and a sign-out tells the cloud without
  waiting on it once the Keychain has let the session go
  (`apps/mobile/src/auth/phone-auth.ts`). Each launch and each return to the
  front asks Better Auth for the session, which slides it, and one it no longer
  holds signs the phone out (`apps/mobile/src/lib/compose-runtime.ts`). Nothing
  reads the Keychain behind a lock screen, since the app runs nothing in the
  background and a share opens it in front; it never moves to another phone by
  a backup, and a Keychain that refuses the write fails the sign-in, whose
  session is signed out again, rather than a sign-in that is gone on the next
  launch. `tools/e2e/src/harness/phone-runtime.ts` calls the same routes with a
  plain fetch, since the Expo client loads in no node process. Rejected: a
  device credential of the phone's own (a second kind of sign-in the cloud
  reads beside Better Auth's sessions, for no gain); after first unlock (a
  looser class for a read no path makes).

- **A PHONE SAVE IS ONE CREATE WHERE THE LIBRARY'S SCOPE SAVES.** A link is
  saved for the cloud's fill to read, and a save of an address the library
  holds answers that item; a thought is a note named by its first line; a
  non-web link is refused in `@repo/contract/items/item-kind`'s words
  (`apps/mobile/src/items/phone-saves.ts`). A save, a new note and a move to
  Deleted need a connection and say so rather than wait; only a share waits.
  `tools/e2e/src/scenarios/phone-file-ops-hosted.ts`.

- **A PHONE PHOTO IS AN IMAGE ITEM OF ITS OWN, AT MOST 2048PX WITH NO EXIF, A
  JPEG UNLESS IT WAS A PNG.** The Mac's editor draws no HEIC, so a photo the
  photo button adds is re-encoded to at most 2048px on its long edge with no
  EXIF, so no location reaches the library's history, and saved as a file item
  once its bytes are sent up, which needs a connection; the bytes sent stay in
  the cache. A PNG is re-encoded as a PNG, since a JPEG has no transparency and
  draws it black (`apps/mobile/src/items/photo-ingest.ts`,
  `apps/mobile/src/items/photo-plan.ts`). A picture pasted into a note's text
  is kept as the bytes the paste handed over, with whatever details they
  carry, as on every device. Rejected: a picked photo placed in a note (the
  photo button is the library's, where no note is open; a paste into a note's
  text lands in that note).

- **A SHARE IS A SAVE THE APP MAKES, AS ITS LINK; THE EXTENSION ONLY HANDS IT
  OVER.** The share extension (`expo-share-intent`'s "Save to Inteligir", for
  a page, a link or text, never a photo or a file) writes the share into the
  App Group and opens the app at its handoff address
  (`apps/mobile/src/app/+native-intent.ts`, which never throws). The signed-in
  app saves a page or a link as its link, which the cloud's fill reads, and
  text alone as a thought (`apps/mobile/src/items/share-outbox.ts`). Words
  shared beside the link are a new item's note, and an unread link is named by
  its address or by the title the share sheet gave
  (`apps/mobile/src/items/share-payload.ts`). Residual: an app that hands a
  page's name as text leaves a note repeating the title once the cloud reads
  it, redundant and not lost. Rejected: reading on the phone (a hidden reader,
  a cookie-less fetch walking private space and an HTTP cache to wipe, for
  pages the cloud reads anyway; a page only a home or office network reaches is
  one the cloud cannot read, and says so); short words naming an unread link
  (the cloud renames only an item its address names, so the page's own title
  would never show).
  A page keeps its address to the last character, since it comes over as
  nothing but that address; text takes its link and its note from
  `apps/mobile/src/items/link-in-text.ts`, every spelling of the link out and
  its lines kept, so text holding a link is a link share whatever the
  extension's search found, and is saved as any other. Rejected:
  expo-share-intent's `webUrl` for text (its search stops at a bracket, a comma
  or an accented letter, so the wrong page is saved, and finds nothing straight
  after a bracket or a colon, so no page is);
  trimming a sentence's marks off every share (the real last character of
  `…/Oklahoma!`); reading a link up to the first space (a language with no
  spaces runs its sentence on from the link, and an emoji sits right after one).
  It keeps the share and only then lets the share go, so a signed-out share
  waits in the share context, and so does one a sign-out caught mid-keep
  (`apps/mobile/src/items/share-inbox.tsx`), and a share made while one
  settles is settled after it (`apps/mobile/src/items/share-queue.ts`).
  Rejected: expo-sharing (experimental receive, no page title); an extension
  that saves.

- **A SHARE IS KEPT ON THE PHONE BEFORE ITS FIRST CALL, AND WAITS THERE UNTIL
  IT LANDS.** The outbox writes each share to the key-value store under the op
  id it is sent with, then sends it, and sends every one still waiting at each
  launch, resume and reconnect, so a share made offline survives a relaunch and
  lands once however many sends a lost answer repeats; one the cloud refuses
  waits, said, until it is tried again or let go
  (`apps/mobile/src/items/share-outbox.ts`). The Library says "N saves waiting"
  rather than draw a card for an item the cloud has not made
  (`apps/mobile/src/library/unsent-banner.tsx`), and a sign-out with any asks
  first, and then discards them (owner decision).
  `tools/e2e/src/scenarios/phone-offline-share.ts`. Rejected: the share
  context alone (it holds one share, and loses it to the next); an optimistic
  card (a listing row the cloud never made, to reconcile once it lands).

- **THE PHONE ASKS THE ACCOUNT'S BUILT-IN AGENT, ONLINE ONLY, THROUGH THE PANEL
  EVERY DEVICE DRAWS.** A conversation is the account's, so the phone lists the
  same threads as the Mac and draws a thread's events, approvals and previews
  from `@repo/agent-panel`, natively (`apps/mobile/src/app/agent/[thread].tsx`);
  a send asked about an item carries it as the view's context. A send and an
  approval wait for a connection and say "Needs a connection" rather than
  queue, since a turn runs in the cloud. Residual: no Undo of a turn on the
  phone; the agent panel on the Mac or in a browser tab undoes it. Rejected: a
  read-only list of the Mac's threads.

## The screens' look

- **THE PHONE IS STYLED WITH NATIVEWIND OVER THE APP'S OWN TOKENS, AS kyh/init's
  PHONE IS** (owner decision). A screen writes Tailwind `className`s, which
  Metro compiles through PostCSS and react-native-css
  (`apps/mobile/metro.config.js`, `apps/mobile/postcss.config.js`) from one
  sheet (`apps/mobile/src/styles.css`). The palette is its variables, light at
  `:root` and dark under `prefers-color-scheme: dark` (react-native-css reads no
  `.dark`), so the system scheme recolours every class, named as the web's
  tokens are (`bg-card`), a placeholder included (`placeholder:`). A colour
  React Native takes as a value (a navigator's options, an indicator, a
  background) reads `apps/mobile/src/lib/palette.ts`, which holds only those,
  and which `apps/mobile/src/styles.test.ts` holds equal to the compiled sheet
  in both schemes. Rejected: `StyleSheet.create` over a copied palette (a second
  spelling in each screen); `@repo/ui` (DOM, which the dep-dag guard refuses).

- **THE PHONE'S STYLE PINS ARE NATIVEWIND'S RELEASE CANDIDATE PAIR, SET UP AS
  ITS INSTALL SAYS, AND A REM IS THE WEB'S.** Exact: nativewind 5.0.0-rc.0,
  its one Tailwind 4 line, and the react-native-css 3.1.0-rc.0 it peers
  exactly, which compiles the sheet with the lightningcss 1.30.1 the install
  pins, since a later one may fail to read it (`pnpm-workspace.yaml`). The
  sheet imports Tailwind's theme and preflight layered and its utilities
  unlayered, as the install does, so no default sits above a class, and its
  `:root` font size is the 16px every rem is read at, so Tailwind's scales are
  the web's (`p-4` is 16); a type size is the phone's own, by its px, with a
  line height a `leading-*` class beside it (`apps/mobile/src/styles.css`).
  Rejected: 5.0.0-preview.4 over 3.0.7 (a rem through a variable at 14px, a
  line-height class drawing nothing); waiting for nativewind 5 stable;
  lightningcss unpinned (the install warns the sheet may then not build).

- **A MULTI-LINE PHONE FIELD IS PADDED `pt-*` AND `pb-*`.** `py-*` compiles to
  `paddingBlock`, and iOS gives a multi-line `TextInput` with no `paddingTop`
  its own 5. `apps/mobile/src/styles.test.ts` fails on a `py-*` there.

## Repo guards, vendoring and tooling

- **THE PHONE SHIPS THROUGH EAS TO TESTFLIGHT, AND AN UNSET CLOUD URL IS THE
  PRODUCTION ORIGIN ON BOTH CLIENTS.** `pnpm testflight:mobile` builds on EAS
  and submits, iPhone only (owner decision); signing credentials live on EAS,
  never in the repo, and build numbers are EAS's (`appVersionSource: remote` in
  `apps/mobile/eas.json`), so no commit bumps one.
  `PRODUCTION_CLOUD_ORIGIN` (`@repo/contract/origin`) is the one fallback
  of the phone's `getCloudUrl` and the extension's connection; the phone reads
  `EXPO_PUBLIC_CLOUD_URL` at bundle time and refuses a malformed one. Rejected:
  per-profile env in `eas.json` (a second spelling of the origin); a fallback to
  a dead host (a misconfigured build that can only fail).

- **THE PHONE'S VERSION IS THE PRODUCT'S, AND ITS SHARE EXTENSION A SIGNED
  TARGET OF ITS OWN.** The marketing version is `apps/mobile/package.json`'s,
  one with the Mac's and the extension's, and EAS builds with the repo's node and
  pnpm (`tools/repo-guards/src/release-versions.test.ts`). A JS-only fix is an
  EAS Update to builds of the same native fingerprint, a native change a new
  build (owner decision). The share extension is a target of its own in the App
  Group `group.com.inteligir.mobile`, both the plugin's defaults and both signed
  by EAS, and the group's defaults are a declared reason (`1C8F.1`);
  `apps/mobile/src/app-config.test.ts` holds the group, exactly one app
  extension, its activation rules and every reason to what App Store Connect
  judges.
