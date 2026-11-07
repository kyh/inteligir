# Decisions: @repo/mobile

The phone: its editor page, its replica and its files, the agent, its look, and
how it ships.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Editor and dialect

- **THE PHONE'S EDITOR IS A VITE PAGE CARRIED IN THE BINARY: ONE CLASSIC SCRIPT
  IN A WEBVIEW, BEHIND A TYPED, NONCE-STAMPED BRIDGE** (owner decision).
  WKWebView loads no module script or `crossorigin` tag from `file://`
  (vitejs/vite#14483), so the build is one IIFE and fails on anything else
  (`apps/mobile-editor/vite/classic-page.ts`). The page ships in the bundle, so
  an item opens offline (`apps/mobile/plugins/with-editor-page.js`), and in the
  native fingerprint, so an EAS Update beside another page matches no install
  (`apps/mobile/fingerprint.config.js`). Rejected: a React Native renderer of
  the dialect (cannot edit, degrades what it does not model); Expo DOM
  components (a second compile of the editor, typechecked under the phone's
  TypeScript 6, not the editor's Vite, React Compiler and TypeScript 7).

- **NATIVE REACHES THE EDITOR PAGE ONLY THROUGH ITS DOOR, AND THE WEBVIEW IS ONE
  POLICY.** The door is installed non-writable on `window`, never a message
  event a child frame's `parent.postMessage` could forge, and every frame after
  `init` carries the nonce (`apps/mobile-editor/src/bridge/page-bridge.ts`). The
  wire breaks freely, since one binary ships both ends
  (`packages/editor-bridge/src/protocol.ts`); an item page's host is the item
  session's ops over the phone's replica
  (`apps/mobile-editor/src/item/item-host.ts`). The WebView loads the page and
  its frames, hands a followed web link to Safari and refuses the rest; its
  origin list admits every address, because the library hands what that list
  refuses to the OS before the policy runs
  (`apps/mobile/src/editor/editor-host.ts`). Every injected script ends `true;`
  and every frame is a string. `tools/e2e/src/scenarios/phone-editor-page.ts`
  loads the built page from `file://`.

- **THE PHONE'S BLOCK MERGE AND ITS SHARE READER RUN IN A HEADLESS PAGE.** The
  replica settles a `CONFLICT` with the editor's diff3, which needs Plate and
  its markdown pipeline, and a shared page is read by `@repo/page-reader` over
  a DOM; both live only in the page, so a hidden WebView loads it headless and
  answers each `mergeJob` and `fillJob`
  (`apps/mobile-editor/src/headless/headless-mode.ts`,
  `apps/mobile/src/editor/headless-page-host.ts`), which is why the engine's
  merge resolves. Rejected: the editor compiled into Hermes (a second build of
  it, under TypeScript 6); a merge on the cell (a second write policy).

## Cloud, sync and accounts

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  The session and the login flow publish stores the screens subscribe to, so a
  revocation and a refused login show (`apps/mobile/src/lib/compose-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`). A sign-in is ONE library, its
  replica, `/v1` client, query helpers, files and previews made together and
  closed together, so a revocation a pass of the replica hears ends it for all,
  a refusal on any other call waits for the next pass, and a refusal heard
  under an earlier sign-in never ends the next. The route guard,
  never a per-screen branch, decides which screens exist (`Stack.Protected` in
  `apps/mobile/src/app/_layout.tsx`): signed in, the Library, an item, a
  script-less viewer of a file and the agent; signed out, the sign-in.

- **THE PHONE RUNS THE REPLICA ENGINE OVER EXPO-SQLITE, AND HOLDS ITS SOCKET
  ONLY IN THE FOREGROUND.** The Mac's engine (`@repo/library-replica`) reads,
  lists and searches offline and queues every write with its base, over one
  expo-sqlite file in WAL: each transaction an exclusive one behind one JS
  write lock, every value bound, every statement finalized
  (`apps/mobile/src/lib/expo-replica-sql.ts`). The background suspends the
  replica and closes the socket, since iOS suspends the app anyway; a resume
  or a reconnect pulls and sends (`apps/mobile/src/lib/app-runtime.ts`). The
  phone's own tables are one step in `apps/mobile/src/lib/phone-db.ts`, edited
  in place until EAS's first build (`easProject` in
  `apps/mobile/app.config.js`), then appended. Rejected: a store of the
  phone's own beside the engine (a second model of the library).

- **THE PHONE'S DATABASE AND PINNED FILES ARE IN DOCUMENTS, OUT OF THE DEVICE
  BACKUP.** Both download again or are sent from here (owner decision), so
  `apps/mobile/modules/backup-exclusion` keeps them out of the iCloud backup
  (`apps/mobile/src/files/expo-file-folders.ts`). A sign-in, a sign-out and a
  revocation wipe the rows and every file; the boot keeps them, and a kept
  credential over an empty database pulls the library afresh.

- **A FILE'S BYTES ARE KEPT BY ITS HASH, FETCHED ONCE: PINNED, OR CACHED AND
  DROPPED OLDEST FIRST.** A file is downloaded once however many screens ask
  for it at once, and a cover's thumbnail is made from the bytes that crossed.
  A staged upload, and a file a live note of the person's embeds, are pinned in
  Documents; every other file and thumbnail is in the purgeable cache, its use
  stamped in `phone_files` and the least recent dropped past the cap. An upload
  whose write landed moves into the cache, or stays pinned, so the phone never
  downloads what it sent. Each file keeps the type it was staged as or the
  cloud served (`phone_files`, `phone_staged`), which the item page draws a
  note's file by over the bridge, and one pasted there goes through the
  replica's outbox (`apps/mobile-editor/src/item/item-host.ts`). A file over
  512 KB lists from a 320 px thumbnail made once. A cover is decoded in the
  app's own process, one at a time and never past
  `FILL_LIMITS.coverMaxPixels`: it is drawn whole only when its header says it
  is small, any other picture is measured by the decoder before it decodes,
  and one refused or that made no thumbnail shows the card's placeholder, since
  a few bytes can name a bitmap that kills the app on every launch
  (`apps/mobile/src/files/expo-thumbnail.ts`). A screen waiting on a file it
  could not reach asks again after each pass of the replica that ends clean, a
  failed one saying nothing of the file
  (`apps/mobile/src/files/watch-file.ts`). A sign-out moves the cache's
  generation, so a download begun before it lands nothing
  (`apps/mobile/src/files/file-cache.ts`). Rejected: `expo-file-system/legacy`
  (its promise API is deprecated); a staged upload discarded once sent (the
  next draw downloaded what the phone had just sent); a type read from the
  first bytes (no sniff names a recording, which WebKit then may not play).

- **THE PHONE'S CREDENTIAL IS IN THE KEYCHAIN, THIS DEVICE ONLY, WHILE UNLOCKED.**
  Nothing reads it behind a lock screen, since the app runs nothing in the
  background and a share opens it in front. It never moves to another phone by
  a backup, and a Keychain that refuses the write fails the sign-in, whose
  device is signed out again, rather than a sign-in that is gone on the next
  launch (`apps/mobile/src/credential/secure-store-credential.ts`). Rejected:
  after first unlock (a looser class for a read no path makes).

- **A PHONE SAVE IS ONE CREATE WHERE THE LIBRARY'S SCOPE SAVES.** A link is
  saved for the cloud's fill to read, and the cell folds it onto the item
  already holding its address; a thought is a note named by its first line; a
  non-web link is refused in `@repo/notes/items/item-kind`'s words
  (`apps/mobile/src/items/phone-saves.ts`). A sign-out with anything unsent
  asks first, and then discards it (owner decision).
  `tools/e2e/src/scenarios/phone-file-ops-hosted.ts`.

- **A PHONE PHOTO IS AN IMAGE ITEM OF ITS OWN, AT MOST 2048PX WITH NO EXIF, A
  JPEG UNLESS IT WAS A PNG.** The Mac's editor draws no HEIC, so a photo the
  photo button adds is re-encoded to at most 2048px on its long edge with no
  EXIF, so no location reaches the library's history, and saved as a file item
  whose bytes are staged, pinned, until the upload lands, then kept. A PNG is
  re-encoded as a PNG, since a JPEG has no transparency and draws it black
  (`apps/mobile/src/items/photo-ingest.ts`,
  `apps/mobile/src/items/photo-plan.ts`). A picture pasted into a note's text
  is kept as the bytes the paste handed over, with whatever details they
  carry, as on every device. Rejected: a picked photo placed in a note (the
  photo button is the library's, where no note is open; a paste into a note's
  text lands in that note).

- **A PHONE HIGHLIGHT IS THE EDITOR'S, AND THE SHEET WRITES ITS ENTRIES** (owner
  decision: the phone annotates and replies). The page's highlight and its note
  reach the replica as the library's page sends them
  (`apps/mobile/src/editor/item-ports.ts`); the sheet adds a bare highlight's
  note, a reply and a delete as entries signed `user`
  (`apps/mobile/src/annotations/annotation-edits.ts`), and a card shows the
  root's stored quote above its note. Rejected: the live passage (the Mac's
  passage projection, for a line the quote holds).
  `tools/e2e/src/scenarios/phone-annotations-hosted.ts`.

- **A SHARE IS A SAVE THE APP MAKES, READ ON THE PHONE; THE EXTENSION ONLY HANDS
  IT OVER.** The share extension (`expo-share-intent`'s "Save to Inteligir", for
  a page, a link or text, never a photo or a file) writes the share into the
  App Group and opens the app at its handoff address
  (`apps/mobile/src/app/+native-intent.ts`, which never throws). The signed-in
  app fetches the page itself, judging each redirect by its spelling
  (`apps/mobile/src/items/page-fetch.ts`), reads it in the headless page and
  saves it read, cover and all; a page it cannot read now is saved as its
  link, which the cloud's fill reads (`apps/mobile/src/items/share-save.ts`).
  Words shared beside the link are never lost: they are the item's note, or
  an unread link's title when they are short enough to name it, since the
  cloud keeps a title it is given and a page read names itself
  (`apps/mobile/src/items/share-payload.ts`).
  It opens the item and only then lets the share go, so a signed-out share
  waits (`apps/mobile/src/items/share-inbox.tsx`), and a share made while one
  settles is settled after it (`apps/mobile/src/items/share-queue.ts`).
  Rejected: expo-sharing (experimental receive, no page title); an extension
  that saves.

- **THE PHONE ASKS THE ACCOUNT'S BUILT-IN AGENT, ONLINE ONLY, THROUGH THE PANEL
  EVERY DEVICE DRAWS.** A conversation is the account's, so the phone lists the
  same threads as the Mac and draws a thread's events, approvals and previews
  from `@repo/agent-panel`, natively (`apps/mobile/src/app/agent/[thread].tsx`);
  a send asked about an item carries it as the view's context. A send and an
  approval wait for a connection and say "Needs a connection" rather than
  queue, since a turn runs in the cloud. Residual: no Undo of a turn on the
  phone; the Mac's History undoes it. Rejected: a read-only list of the Mac's
  threads.

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
  `PRODUCTION_CLOUD_ORIGIN` (`@repo/contract/cloud/origin`) is the one fallback
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
