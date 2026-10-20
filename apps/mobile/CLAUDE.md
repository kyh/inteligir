# Decisions: @repo/mobile

The phone: its editor page, its offline store and queue, its look, and how it
ships.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Editor and dialect

- **THE PHONE'S EDITOR IS A VITE PAGE CARRIED IN THE BINARY: ONE CLASSIC SCRIPT
  IN A WEBVIEW, BEHIND A TYPED, NONCE-STAMPED BRIDGE** (owner decision).
  WKWebView loads no module script or `crossorigin` tag from `file://`
  (vitejs/vite#14483), so the build is one IIFE and fails on anything else
  (`apps/mobile-editor/vite/classic-page.ts`). The page ships in the bundle, so
  a note opens offline (`apps/mobile/plugins/with-editor-page.js`), and in the
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
  (`apps/mobile-editor/src/bridge/protocol.ts`); the page's host is the editor's
  own write policy (`apps/mobile-editor/src/host/page-host.ts`). The WebView
  loads the page and its frames, hands a followed web link to Safari and refuses
  the rest; its origin list admits every address, because the library hands
  what that list refuses to the OS before the policy runs
  (`apps/mobile/src/editor/editor-host.ts`).
  `tools/e2e/src/scenarios/phone-editor-page.ts` loads the built page from
  `file://`.

## Cloud, sync and accounts

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  `SyncRuntime` and the login flow publish stores the screens subscribe to, so a
  revocation and a refused login show (`apps/mobile/src/sync/sync-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`). A sign-in is ONE session: every
  runtime reads under `SyncRuntime`'s, so a revocation any request hears ends it
  for all, and a refusal heard under an earlier sign-in never ends the next
  (`apps/mobile/src/lib/compose-runtime.ts`). The route guard, never a
  per-screen branch, decides which screens exist (`Stack.Protected` in
  `apps/mobile/src/app/_layout.tsx`): signed in, the Library, an item and a
  script-less viewer of a picture, a PDF or a page's copy, which a card naming a
  file that is no note opens (`opensFiles`, `packages/editor/src/host-io.ts`);
  signed out, the sign-in.

- **THE PHONE HOLDS THE ACCOUNT'S SOCKET ONLY IN THE FOREGROUND, AND ASKS NO
  AGENT.** A Mac's push to the hosted vault pings every other device's socket,
  so a phone in the foreground refreshes its mirror at once; the background
  closes it, since iOS suspends the app anyway, and a resume refreshes and
  checks the sign-in (`apps/mobile/src/sync/sync-runtime.ts`). The phone holds
  no thread and offers no Ask agent (THE PHONE ASKS NO AGENT, in
  `apps/web/CLAUDE.md`): no touch toolbar row
  (`packages/editor/src/touch-toolbar.tsx`), and the page's host answers an
  agent request with nothing. Rejected: a read-only list of the Macs' threads
  (the thread log kept for transcripts the phone cannot act on).

- **THE PHONE HOLDS EVERY NOTE'S TEXT IN SQLITE, AND EACH ITEM'S CARD BESIDE IT,
  AND ITS MIRRORED COMMIT MOVES ONLY WHEN THE MIRROR IS WHOLE.** Each file the
  tree names has a row holding its oid and first commit (an attachment is
  fetched once) and a doc's or store's text, a doc's with the id and aliases the
  resolver's alias and uuid tiers read; a refresh cut short resumes. ONE
  `user_version`, so any module's table is a step in
  `apps/mobile/src/lib/phone-db.ts`; until EAS's first build (`easProject` in
  `apps/mobile/app.config.js`) the schema is one step edited in place,
  defaulting no field for an older row, then steps are appended, never edited.
  Rejected: a body cache keyed `(commit, path)` over an in-memory tree (blank
  offline from cold, every body lost to any commit, no frontmatter).
  `apps/mobile/src/notes/vault-mirror.ts`.

- **THE PHONE'S DATABASE IS ONE FILE IN DOCUMENTS, OUT OF THE DEVICE BACKUP.**
  One expo-sqlite file, never in the purgeable cache, kept out of the iCloud
  device backup (owner decision: it downloads again) by
  `apps/mobile/modules/backup-exclusion`, as is the outbox's folder of staged
  photos, whose rows it holds (`excludedFromBackup` in
  `apps/mobile/src/notes/outbox-files.ts`). A sign-in, a sign-out and a
  revocation wipe the rows and the attachments, thumbnails included; the boot
  restore keeps them. `apps/mobile/src/notes/notes-store.ts`.

- **AN ITEM'S CARD IS READ WHEN ITS TEXT LANDS, AND ITS COVER PER LISTING.** A
  doc's row holds its card (`item`: facts, first embeds, the page copy's links,
  medium links, tags), read in the scan that lands its text, so the Library
  lists thousands of items parsing none, and an unsent text's card is read once
  per change. A medium no doc names lists as its own item by the Mac's keys
  (`fileRefsOf`, `@repo/notes/items/library-index`). Cover and original resolve
  per listing, never stored (`apps/mobile/src/library/library-view.ts`); a cover
  over 512 KB draws from a 320 px JPEG made once
  (`apps/mobile/src/library/cover-thumbs.ts`), so nothing remote loads in a
  list. Rejected: parsing each listed item (a 2k-item library pays it per
  relist).

- **A PHONE EDIT IS A QUEUED WRITE WITH ITS BASE, AND THE PHONE SETTLES ITS OWN
  CONFLICTS.** A write carries its base, the editor's `expected` guard, checked
  against the phone's text under the store's write lock; a mismatch answers that
  text for the page's own merge. A write to a path the last row writes replaces
  its text and KEEPS THE FIRST BASE, so three offline saves are one write. A 409
  is settled by `reconcileFile` (`@repo/notes/sync/reconcile-file`), the
  desktop's verdict, url-item first, so a phone's tag or note on a link a Mac
  filled meanwhile settles on one text with no copy. Rejected: a merge in the
  store or on the Worker (a second write policy).
  `apps/mobile/src/notes/notes-store.ts`,
  `apps/mobile/src/notes/outbox-reconcile.ts`.

- **A SETTLED RESULT IS KEPT ON ITS ROW, AND A LANDING MOVES THE MIRROR WITH
  IT.** The result and its copy are ONE set, stored on the row before it is
  sent, so an answer lost after the vault applied it is resent unchanged and
  answered as already held. A landing moves the mirror atomically with retiring
  its row, and a refresh never overwrites a row that landed after it read, since
  its tree may predate the write. Rejected: replaying the intent after a lost
  answer (reconciles the phone against its own landed set and can copy it
  again). `apps/mobile/src/notes/vault-outbox.ts`.

- **THE OUTBOX HOLDS A WRITE DURABLY BEFORE IT RESOLVES, AND DROPS NOTHING.**
  Reads, the listing and the resolver see a write from then on; rows go to
  `POST /v1/vault/commit` oldest first, one change set each, on every write,
  resume, reconnect and backoff. Unreachable keeps the queue; a refusal no
  resend passes PARKS its row with its bytes while other paths go on; a
  sign-out with anything unsent asks first (owner decision: it then discards
  them, and a revocation wipes them with the mirror).
  `apps/mobile/src/notes/vault-outbox.ts`,
  `tools/e2e/src/scenarios/phone-offline-edit.ts`.

- **THE PHONE'S FILE VERBS PLAN WITH THE SERVER'S PURE RULES, AND EACH IS ONE
  CHANGE SET.** Create, rename, delete and a photo
  (`apps/mobile/src/notes/file-ops.ts`) run the server's rules (`plan-rename`,
  `store-removal`, `asset-name` in `@repo/notes`), since a phone copy is a
  second spelling that drifts; no folder verbs (owner decision: an
  item changes folder on the Mac). A rename over the phone's link graph is ONE
  row: the move, the new text and every rewritten note; a rewritten note
  another device changed first keeps its bytes and is named
  (`reconcileRename`), and the old stem's alias still answers. Rejected: link
  rewrites as their own rows (a rename could land without them); a typed name
  cleaned up rather than refused (a title never saved).

- **A PHONE DELETE TAKES THE NOTE'S ANNOTATIONS AND THE FILES ONLY IT LINKS, IN
  ITS ONE CHANGE SET.** The annotation store goes too, so a note the vault keeps
  because another device edited it keeps its annotations; the freed files are
  `attachmentsFreedBy` (`@repo/notes/knowledge/attachment-removal`) over the
  phone's link graph, and none while any held doc's text is missing, since that
  doc could link them. The confirm names how many go.

- **A PHONE SAVE IS ONE CREATE IN `Unsorted/`.** A link's stub is named by
  `itemStem` and deduped by url key, a thought is a note named by its first
  line, and a non-web link is refused in `@repo/notes/items/item-kind`'s words,
  since the phone reaches no `/local` module
  (`apps/mobile/src/items/item-ops.ts`). The dedupe waits for the boot to read
  the rows back and looks again before each try, so a share the app opens with
  never checks an empty listing. A save the list in view would not show says
  where it went, and every note the phone makes says when it was `saved`.

- **A PHONE PHOTO IS A JPEG OF AT MOST 2048PX, WITH NO EXIF.** The vault takes
  no HEIC and the Mac's editor cannot draw it, so a photo is re-encoded to at
  most 2048px on its long edge, and the re-encode writes no EXIF, so no location
  reaches the vault's history (`apps/mobile/src/notes/photo-ingest.ts`).

- **A PHONE HIGHLIGHT IS ITS MARKERS AND A BARE ENTRY IN ONE CHANGE SET** (owner
  decision: the phone annotates and replies). The page's flush that writes a
  highlight's markers goes as `addAnnotation`, carrying the bare entry and its
  quote (`apps/mobile-editor/src/host/page-host.ts`); the phone plans the entry
  under its write lock and queues markers and store as ONE `annotation` row
  (`editAnnotations` in `apps/mobile/src/notes/notes-store.ts`), an id-less item
  minting its id by the desktop's line cut, every entry signed `user`. Rejected:
  markers written as the field opens (the 600ms autosave lands them before any
  annotation); the store in a row after the item's (the same gap). Residual: a
  hardware chord's create lands its entry in a set of its own.

- **THE PHONE'S ANNOTATION SHEET WRITES THE STORE ALONE.** The field adds a
  bare highlight's note, then replies; a note, a reply and a delete are
  store-only rows (`apps/mobile/src/notes/annotation-ops.ts`), with no resolve,
  and a deleted annotation's markers go through the live editor's next write,
  as the desktop's do. A card shows the root's stored `quote` above its note.
  Rejected: the live passage (the Mac's passage projection on the phone, for a
  line the quote holds).

- **THE PHONE'S PAGE DRAWS BY THE ITEM'S ANNOTATIONS, AND A STALE SET SETTLES
  PER PATH.** As the desktop's editor does: the editor ports send
  `annotationMeta` on open, after each of the phone's annotation verbs, and
  when a pull changes the item's store or id
  (`apps/mobile/src/editor/editor-ports.ts`). A stale set settles the item as a
  write and the store by its entries (`reconcileAnnotation` in
  `apps/mobile/src/notes/outbox-reconcile.ts`), so an annotation another device
  made meanwhile keeps both. Residual: two devices giving one id-less item its
  first annotation at once leave one waiting under an id no item carries.

- **A SHARE IS A SAVE THE APP MAKES; THE EXTENSION ONLY HANDS IT OVER.** The
  share extension (`expo-share-intent`'s "Save to Inteligir", for a page, a
  link or text, never a photo or a file) writes the share into the App Group
  and opens the app at its handoff address
  (`apps/mobile/src/app/+native-intent.ts`). The signed-in app reads it
  (`apps/mobile/src/items/share-payload.ts`), saves it through the outbox,
  opens the item and only then lets the share go, so an offline share queues
  and a signed-out one waits (`apps/mobile/src/items/share-inbox.tsx`).
  Rejected: expo-sharing (experimental receive, no page title); an extension
  that saves (the database, outbox and credential in the App Group); a
  `save?url` deep link (any page could fire it).

- **THE PHONE READS THE LINKS IT SAVES, WITH THE MAC'S OWN READER.** A link's
  fill is queued in its stub's transaction (`pending_fills`) and read while the
  app is signed in, online and open (`apps/mobile/src/items/fill-queue.ts`);
  its page reads the bytes in reader mode
  (`apps/mobile-editor/src/fill/serve-fills.ts`), and the item and its cover go
  as ONE write against the stub's text (`apps/mobile/src/items/link-fill.ts`).
  With no lookup hook, the phone follows redirects itself and judges each hop
  by its spelling: a public page reaches no private space, and only over https
  (`apps/mobile/src/items/page-fetch.ts`). Rejected: a Mac filling a phone's
  saves (they waited on one). Residual: a link its phone never read (signed
  out, which asks first; revoked; deleted) waits for a Mac's Refresh.

## The screens' look

- **THE PHONE IS STYLED WITH NATIVEWIND OVER THE APP'S OWN TOKENS, AS kyh/init's
  PHONE IS** (owner decision). A screen writes Tailwind `className`s, which
  Metro compiles through PostCSS and react-native-css
  (`apps/mobile/metro.config.js`, `apps/mobile/postcss.config.js`) from one
  sheet (`apps/mobile/src/styles.css`). The palette is its variables, light at
  `:root` and dark under `prefers-color-scheme: dark` (react-native-css reads no
  `.dark`), so the system scheme recolours every class, named as the web's
  tokens are (`bg-card`). A colour React Native takes as a value (a navigator's
  options, an indicator, a placeholder, a background) reads
  `apps/mobile/src/lib/palette.ts`, which `apps/mobile/src/styles.test.ts`
  holds equal to the compiled sheet in both schemes. Rejected:
  `StyleSheet.create` over a copied palette (a second spelling in each screen);
  `@repo/ui` (DOM, which the dep-dag guard refuses).

- **THE PHONE'S STYLE PINS ARE kyh/init's, AND THE SHEET WRITES AROUND THEM.**
  Exact: nativewind 5.0.0-preview.4 (its only Tailwind 4 line), react-native-css
  3.0.7, and @expo/metro-config's lightningcss at 1.30.1 (3.0's visitor fails to
  deserialize under later ones). 3.0.7 takes no Metro option and inlines a rem
  reached through a variable at 14px, so spacing, radii and type sizes are px at
  the web's 16px rem (`p-4` is 16), the phone's sizes named by their px, each a
  size alone. Rejected: the 5.0 release candidate (it fixes 3.0.7's faults, but
  is not the template's pin before nativewind 5 is stable).
  `pnpm-workspace.yaml` holds the pins; `apps/mobile/src/styles.css` is the
  sheet.

- **A PHONE LINE HEIGHT STAYS IN `style`, AND A MULTI-LINE FIELD IS PADDED
  `pt-*` AND `pb-*`.** react-native-css 3.0.7 resolves a line-height class to
  nothing; `py-*` compiles to `paddingBlock`, and iOS gives a multi-line
  `TextInput` with no `paddingTop` its own 5. `apps/mobile/src/styles.test.ts`
  fails on a class that sets a line height and on a `py-*` there.

## Repo guards, vendoring and tooling

- **THE PHONE SHIPS THROUGH EAS TO TESTFLIGHT, AND AN UNSET CLOUD URL IS THE
  PRODUCTION ORIGIN ON BOTH CLIENTS.** `pnpm testflight:mobile` builds on EAS
  and submits, iPhone only (owner decision); signing credentials live on EAS,
  never in the repo, and build numbers are EAS's (`appVersionSource: remote` in
  `apps/mobile/eas.json`), so no commit bumps one.
  `PRODUCTION_CLOUD_ORIGIN` (`@repo/contract/cloud/origin`) is the one fallback
  of the CLI's config and the phone's `getCloudUrl`; the phone reads
  `EXPO_PUBLIC_CLOUD_URL` at bundle time and refuses a malformed one. Rejected:
  per-profile env in `eas.json` (a second spelling of the origin); a fallback to
  a dead host (a misconfigured build that can only fail).

- **THE PHONE'S VERSION IS THE PRODUCT'S, AND ITS SHARE EXTENSION A SIGNED
  TARGET OF ITS OWN.** The marketing version is `apps/mobile/package.json`'s,
  one with the CLI and the desktop, and EAS builds with the repo's node and
  pnpm (`tools/repo-guards/src/release-versions.test.ts`). A JS-only fix is an
  EAS Update to builds of the same native fingerprint, a native change a new
  build (owner decision). The share extension is a target of its own in the App
  Group `group.com.inteligir.mobile`, both the plugin's defaults and both signed
  by EAS, and the group's defaults are a declared reason (`1C8F.1`);
  `apps/mobile/src/app-config.test.ts` holds the group, exactly one app
  extension, its activation rules and every reason to what App Store Connect
  judges.
