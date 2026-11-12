# Decisions: @repo/mobile

The phone: its editor, its cache, its shares and its files, the agent, its look, and how it ships.

## The phone's editor

- **The phone's editor is an Expo DOM component over `@repo/editor`, built by `expo export` and
  shipped in EAS updates, on react-native-webview** (owner decision). One editor on every device, a
  fix a JS update, and react-native-webview's navigation policy and keyboard raised by code.
  `apps/mobile/src/editor/page/note-page.tsx`.
- **The phone's editor is one chunk, its fonts written into its sheet.** An exported page fails to
  load a lazy chunk it split off (`EXPO_NO_BUNDLE_SPLITTING`) or a file the export moved.
  `apps/mobile/inline-fonts.js`.
- **Native reaches the phone's editor only through its actions and props, and the web view is one
  policy.** Actions answer in JSON and props are a few primitives sent every render, since a
  handle into the editor is lost with each reload.
  `apps/mobile/src/editor/page/library-actions.ts`.
- **The web view hands a web link a tap followed to Safari and refuses the rest.** Its origin list
  admits every address, since the library hands what that list refuses to the OS before the policy
  runs. `apps/mobile/src/editor/web-view-policy.ts`.
- **A production editor inserts its content policy before it draws, its one connection the note's
  socket.** Expo's door into the page carries no nonce, so only the editor's own script may run.
  `apps/mobile/src/editor/page/page-policy.ts`.
- **The phone edits a note live as every device does, and reads what it last held with no
  connection.** It turns read-only the moment the network or iOS's suspension cuts the socket, and
  its life is one value, since a second ask or leave must not be representable.
  `apps/mobile/src/editor/note-page-life.ts`.
- **New note opens with the caret at the end and the keyboard up, and a tag chip does nothing on
  the phone** (owner decision). `apps/mobile/src/editor/page/page-host.ts`.

## Cloud and accounts

- **On the phone, the runtime that moves a value is the one that notifies.** A sign-in is one
  library made and closed together, so a revocation any call hears ends it for all, once, and the
  route guard alone decides which screens exist. `apps/mobile/src/lib/app-runtime.ts`.
- **The phone reads through TanStack Query, its cache kept between launches, and holds its socket
  only in the foreground.** What was last read shows offline and a write is never kept, since the
  cloud keeps the truth, and iOS suspends a background app's socket anyway.
  `apps/mobile/src/lib/compose-runtime.ts`.
- **The phone's key-value store is out of the device backup, and its files are in the cache**
  (owner decision). A restore onto another phone would send waiting shares under nobody's sign-in,
  and a sign-in, sign-out or revocation clears the cache, shares and files.
  `apps/mobile/modules/backup-exclusion`.
- **A file's bytes are kept by their hash, fetched once, in the purgeable cache.** A file over 512
  KB lists from a thumbnail and no cover decodes past `FILL_LIMITS.coverMaxPixels`, since a few
  bytes can name a bitmap that kills the app on every launch.
  `apps/mobile/src/files/expo-thumbnail.ts`.
- **The phone signs in with a Better Auth session, kept by its Expo client in the Keychain, this
  device only, while unlocked.** Every call sends it under `expo-origin` with `credentials: "omit"`,
  since a credential of the phone's own is a second kind of sign-in for no gain.
  `apps/mobile/src/auth/keychain-storage.ts`.
- **A device signs out through Better Auth's own `/api/auth/sign-out`, and no
  unreachable cloud holds that sign-out open.** The phone drops its copy first
  and keeps the session if the copy will not go; a tab, holding nothing, ends
  the session first. `apps/mobile/src/lib/compose-runtime.ts`.
- **A phone save is one create where the library's scope saves.** A link waits for the cloud's
  fill and a thought is a note named by its first line, and a save, a new note or a delete needs a
  connection and says so, since only a share waits. `apps/mobile/src/items/phone-saves.ts`.
- **A phone photo is an image item of its own, at most 2048px with no EXIF, a JPEG unless it was a
  PNG.** The Mac's editor draws no HEIC, no location may reach the library, and a JPEG draws
  transparency black. `apps/mobile/src/items/photo-plan.ts`.
- **A share is a save the app makes, kept on the phone before its first call until it lands; the
  share extension only hands it over.** The outbox sends what waits at each launch, resume and
  reconnect, so it lands once, and a sign-out with any asks, then discards them (owner decision).
  `apps/mobile/src/items/share-outbox.ts`.
- **A shared text's link is read whole, to its last character.** Every spelling of the link comes
  out with its lines kept, since expo-share-intent's `webUrl` stops at a bracket, a comma or an
  accented letter and saves the wrong page. `apps/mobile/src/items/link-in-text.ts`.
- **The phone asks the account's built-in agent, online only, through the panel every device
  draws.** A send and an approval need a connection, since a turn runs in the cloud, and Undo of a
  turn is the Mac's or a tab's. `apps/mobile/src/app/agent/[thread].tsx`.

## The look

- **The phone is styled with NativeWind over the app's own tokens, as kyh/init's phone is** (owner
  decision). One sheet's light and dark variables, named as the web's tokens, and `palette.ts` only
  for a colour React Native takes as a value, since `StyleSheet.create` respells it per screen.
  `apps/mobile/src/styles.css`.
- **The phone's style pins are NativeWind's release candidate pair, set up as its install says, and
  a rem is the web's.** nativewind 5.0.0-rc.0, react-native-css 3.1.0-rc.0 and lightningcss 1.30.1
  exact, since a later lightningcss may fail to read the sheet. `pnpm-workspace.yaml`.
- **A multi-line phone field is padded `pt-*` and `pb-*`.** `py-*` compiles to `paddingBlock`, and
  iOS gives a multi-line `TextInput` with no `paddingTop` its own 5.
  `apps/mobile/src/styles.test.ts`.

## Shipping

- **The phone ships through EAS to TestFlight, and an unset cloud URL is the production origin on
  both clients.** iPhone only (owner decision), credentials and build numbers EAS's, and
  `PRODUCTION_CLOUD_ORIGIN` the one fallback, since per-profile env respells the origin.
  `apps/mobile/eas.json`.
- **The phone's version is the product's, and its share extension a signed target of its own.** A
  JS-only fix is an EAS Update to builds of the same fingerprint and a native change a new build
  (owner decision); its bundle id, encryption answer and required reasons are held to what App Store
  Connect judges. `apps/mobile/src/app-config.test.ts`.
