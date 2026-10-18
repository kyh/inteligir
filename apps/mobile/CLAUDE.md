# Decisions: @repo/mobile

The phone: its editor page, its offline store and queue, and how it ships.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Editor and dialect

- **THE PHONE'S EDITOR IS A VITE PAGE CARRIED IN THE BINARY: ONE CLASSIC SCRIPT
  IN A WEBVIEW, BEHIND A TYPED, NONCE-STAMPED BRIDGE** (owner decision).
  Rejected: a React Native renderer of the dialect, which cannot edit and
  degrades every construct it does not model. Expo DOM components were rejected
  too: they compile the editor a second way and typecheck it under the phone's
  TypeScript 6, where the editor's own toolchain is Vite, the React Compiler and
  TypeScript 7. WKWebView loads no module script, and no `crossorigin` tag, from
  `file://` (vitejs/vite#14483), so the build is one IIFE and fails on anything
  else (`apps/mobile-editor/vite/classic-page.ts`). Native reaches the page only
  through a door installed non-writable on `window`, never a message event a
  child frame's `parent.postMessage` could forge, and every frame after `init`
  carries its nonce (`apps/mobile-editor/src/bridge/page-bridge.ts`); the wire
  breaks freely, since both ends ship in one binary
  (`apps/mobile-editor/src/bridge/protocol.ts`), and the page's host is the
  editor's own write policy over it
  (`apps/mobile-editor/src/host/page-host.ts`). The page ships in the app
  bundle, so a note opens offline (`apps/mobile/plugins/with-editor-page.js`),
  and its build joins the native fingerprint
  (`apps/mobile/fingerprint.config.js`), so an EAS Update bundled beside another
  page matches no install. The native end is one policy
  (`apps/mobile/src/editor/editor-host.ts`): the WebView loads the page and the
  frames it makes, hands a followed web link to Safari and refuses the rest, and
  its origin list admits every address, because the library hands whatever that
  list refuses to the OS before the policy runs. A write's base is compared with
  the text the phone holds, under the store's write lock, so a change a sync
  landed since comes back for the page's own merge
  (`apps/mobile/src/notes/notes-store.ts`). The suites beside it
  (`apps/mobile/src/editor/editor-host.test.ts`,
  `apps/mobile/src/editor/editor-ports.test.ts`) hold the native end, and
  `tools/e2e/src/scenarios/phone-editor-page.ts` loads the built page from
  `file://` against a scripted phone.

## Cloud, sync and accounts

- **ON THE PHONE, THE RUNTIME THAT MOVES A VALUE IS THE ONE THAT NOTIFIES.**
  `SyncRuntime`, the login flow and the dispatch runtime publish stores the
  screens subscribe to, so a poll pass, a revocation, a refused login and where
  a request to a Mac stands are shown; a refused request keeps its words and the
  reason until dismissed. A sign-in is ONE session: every runtime reads under
  `SyncRuntime`'s, so a revocation any request hears ends the sign-in for all,
  and each checks its fence before recording a refusal, so one heard under an
  earlier sign-in never ends the next
  (`apps/mobile/src/lib/compose-runtime.ts`). Which screens exist is the route
  guard's answer (`Stack.Protected` in `apps/mobile/src/app/_layout.tsx`), never
  a per-screen branch: signed in, the Library, an item, a viewer of a picture,
  a PDF or a page's copy (with no script, reading only its own folder), the
  threads and a thread; signed out, the sign-in. A link or a file card in an
  item that names a file that is no note opens that viewer, which says where any
  other file opens (`opensFiles` in `packages/editor/src/host-io.ts`).
  `apps/mobile/src/sync/sync-runtime.ts`,
  `apps/mobile/src/login/login-store.ts`,
  `apps/mobile/src/dispatch/dispatch-runtime.ts`.

- **THE PHONE HOLDS THE ACCOUNT'S SOCKET ONLY IN THE FOREGROUND, AND A RUNNING
  TURN'S TEXT IS NEVER STORED.** A desktop pushes a running turn every second
  and a half and the cloud pings every other socket on each push, so a phone
  with the socket reads a reply as it grows; the background closes it, since iOS
  suspends the app anyway, and the poll stays for a missed ping. The deltas the
  store drops are folded in memory until each item's `item/completed`
  (`apps/mobile/src/sync/live-turns.ts`), fed only what a page landed, so a page
  pulled twice folds once. Rejected: holding the deltas in the phone's database,
  which a long turn fills with tokens its settled items already carry, and
  folding an item this launch never saw start, which would draw the tail as the
  reply. `apps/mobile/src/sync/sync-runtime.ts`.

- **THE PHONE HOLDS EVERY NOTE'S TEXT IN SQLITE, AND EACH ITEM'S CARD BESIDE
  IT, AND ITS MIRRORED COMMIT MOVES ONLY WHEN THE MIRROR IS WHOLE.** One
  expo-sqlite file in Documents, never the purgeable cache, kept out of the
  iCloud device backup (owner decision: it downloads again) by the local module
  `apps/mobile/modules/backup-exclusion`, as is the outbox's folder of staged
  photos, whose rows that file holds (`excludedFromBackup` in
  `apps/mobile/src/notes/outbox-files.ts`). A row per file the tree names holds
  its oid, the commit its blob first appeared at (so an attachment is fetched
  once), and for a doc or an annotation store its text; a doc's row also holds
  its frontmatter id and aliases, so the resolver's alias and uuid tiers answer
  on the phone, and its library card (`item`: the item facts, the first embeds
  and the page copy's links, every link that names a medium, the tags), all
  read in one scan when the text lands, so a picture, a PDF, a video or a sound
  no doc names lists as an item of its own by the Mac's own keys
  (`fileRefsOf` in `@repo/notes/items/library-index`), so the Library lists thousands of items without parsing one, and an
  unsent text's card is read once per change of it. A card's cover and original
  are resolved per listing, never stored
  (`apps/mobile/src/library/library-view.ts`); a cover draws from the oid-named
  attachment file, and one over 512 KB from a 320 px JPEG made once beside it
  (`apps/mobile/src/library/cover-thumbs.ts`), so nothing remote loads in a
  list. The commit advances only when no wanted row is empty, so a refresh cut
  short resumes. Rejected: a body cache keyed `(commit, path)` beside a tree
  held in memory, which shows nothing on a cold offline launch, loses every body
  to any commit, and holds no frontmatter; and parsing each listed item for its
  card, which a 2k-item library pays on every relist. A sign-in, a sign-out and
  a revocation wipe the rows and the attachments, thumbnails included; the boot
  restore keeps them. The phone's database has ONE `user_version`, so a table
  another module adds is a step in `apps/mobile/src/lib/phone-db.ts`. Until the
  first build EAS makes (`easProject` in `apps/mobile/app.config.js`), no phone
  holds a file worth upgrading, so the schema is ONE step edited in place and a
  stored row's parser defaults no field for an older row; from that build on, a
  step is appended, never edited. `apps/mobile/src/notes/vault-mirror.ts`,
  `apps/mobile/src/notes/notes-store.ts`.

- **A PHONE EDIT IS A QUEUED WRITE WITH ITS BASE, AND THE PHONE SETTLES ITS OWN
  CONFLICTS.** A write is durable in the phone's `outbox` table before it
  resolves, and reads, the listing and the resolver see it from then on; the
  rows go to `POST /v1/vault/commit` oldest first, one change set per row, on
  every write, resume, reconnect and a backoff. A write carries the text it was
  computed from, the editor's `expected` guard, compared with the text the phone
  holds under the store's write lock; a mismatch answers what the phone holds
  for the page's own merge, never a merge in the store, which would be a second
  write policy beside the editor's. A write to a path whose last row writes it
  replaces the text and KEEPS THE FIRST BASE, so three offline saves are one
  write. A 409 is settled on the phone by `reconcileFile`
  (`@repo/notes/sync/reconcile-file`), the desktop's own verdict, which asks the
  url-item verdict first, so a phone's tag or note on a link a Mac filled
  meanwhile settles on one text with no copy; the result and its copy land as
  ONE set, kept on the row before it is sent, so an answer
  lost after the vault applied it is resent unchanged and answered as already
  held. A landing moves the mirror in the transaction that retires the row and
  stamps what it moved, and a refresh skips every row stamped after it read,
  because its tree may predate the write. Nothing is dropped: unreachable keeps
  the queue, a refusal no resend passes PARKS its row with its bytes while other
  paths go on, and a sign-out with anything unsent asks first (owner decision:
  it then discards them, and a revocation wipes them with the mirror). Rejected:
  a merge on the Worker, a second policy beside the desktop's; and replaying the
  intent after a lost answer, which reconciles the phone against its own landed
  set and can copy it again. `apps/mobile/src/notes/vault-outbox.ts`,
  `apps/mobile/src/notes/outbox-reconcile.ts`,
  `tools/e2e/src/scenarios/phone-offline-edit.ts`.

- **THE PHONE'S FILE VERBS PLAN WITH THE SERVER'S PURE RULES, AND EACH IS ONE
  CHANGE SET.** Create, rename, delete and a photo
  (`apps/mobile/src/notes/file-ops.ts`) run the rules the server does
  (`plan-rename`, `store-removal`, `asset-name` in `@repo/notes`), because a
  phone copy is a second spelling that drifts. A rename plans over the phone's
  own link graph and queues the move, the note's new text and every rewritten
  note as ONE row, a changed text going as a delete and a put under the guards a
  move takes; a rewritten note another device changed first keeps its bytes and
  is named (`reconcileRename` in `apps/mobile/src/notes/outbox-reconcile.ts`),
  and the old stem's alias still answers its link. A delete carries the note's
  annotation store, so a note the vault keeps because another device edited it
  keeps its annotations, and the files only it links: `attachmentsFreedBy`
  (`@repo/notes/knowledge/attachment-removal`) over the phone's own link graph,
  in the same change set, and nothing while any held doc's text is missing,
  since that doc could link them; the confirm names how many go. Save is one
  create in `Unsorted/` (`apps/mobile/src/items/item-ops.ts`): a link's stub
  named by `itemStem` and deduped by url key, a thought a note named by its
  first line, a non-web link refused in `@repo/notes/items/item-kind`'s words,
  since the phone reaches no `/local` module; the dedupe waits for the boot to
  read the phone's rows back and looks again before each try, so a share the
  app opens with is never checked against an empty listing; a save the list in
  view would not show says where it went; every note the phone makes says when
  it was `saved`. No folder verbs on the phone: an item moves to another
  folder from the Mac (owner decision). A photo is a JPEG at most 2048px on its long edge
  (`apps/mobile/src/notes/photo-ingest.ts`): a HEIC is no asset type the vault
  takes and the Mac's editor cannot draw it, and the re-encode writes no EXIF,
  so no location reaches the vault's history. Rejected: link rewrites as rows of
  their own, which could land a rename without the links it moved, and a typed
  name cleaned up rather than refused, which shows a title that was never saved.

- **A PHONE HIGHLIGHT IS ITS MARKERS AND A BARE ENTRY IN ONE CHANGE SET**
  (owner decision: the phone annotates and replies). The page's flush that
  writes a highlight's markers goes as `addAnnotation`, not `write`, carrying
  the highlight's bare entry and its quote, and the note follows as
  `editAnnotation`, a row of the store alone
  (`apps/mobile-editor/src/host/page-host.ts`); the phone plans the entry under
  its write lock and queues the markers and the store as ONE `annotation` row
  (`editAnnotations` in `apps/mobile/src/notes/notes-store.ts`), an item without
  an id minting one by the desktop's line cut
  (`@repo/notes/annotations/annotation-key`), every entry signed `user`. The
  sheet's field adds a bare highlight's note, and after that replies; a note, a
  reply and a delete are rows of the store alone
  (`apps/mobile/src/notes/annotation-ops.ts`), and there is no resolve. A card
  shows the root's stored `quote` above its note. A deleted annotation's markers
  go as the desktop's do, through the page's live editor and its next write
  (`annotationsRemoved`). The page draws its ranges by the item's annotations,
  as the desktop's editor does: the editor ports send `annotationMeta` when the
  page opens an item, after each of the phone's own annotation verbs, and when a
  pull changes the item's store or its id
  (`apps/mobile/src/editor/editor-ports.ts`). A stale set is settled per path
  (`reconcileAnnotation` in `apps/mobile/src/notes/outbox-reconcile.ts`): the
  item as a write is, and the store by its entries, so an annotation another
  device made meanwhile keeps both. Rejected: the live passage, which would put
  the Mac's passage projection on the phone for a line the quote already holds;
  markers in at the field's opening, which the 600ms autosave writes long
  before there is an annotation; and a store write in a row of its own after the
  item's, which is the same gap. Residual: a hardware chord's create lands its
  entry in a set of its own; and when two devices each give one id-less item its
  first annotation at once, the other's waits under an id no item carries.

- **A SHARE IS A SAVE THE APP MAKES; THE EXTENSION ONLY HANDS IT OVER.** The
  share extension (`expo-share-intent`'s "Save to Inteligir", offered for a
  page, a link and text, never a photo or a file) writes what was shared into
  the App Group and opens the app at its handoff address, which
  `apps/mobile/src/app/+native-intent.ts` lands on the Library; the signed-in
  app reads it (`apps/mobile/src/items/share-payload.ts`: the page's title from
  its meta, else short text beside the link, any other text the note), saves it
  through the outbox as the Save field does, opens the item and only then lets
  the share go, so a share made offline is queued and one made signed out waits
  for the sign-in (`apps/mobile/src/items/share-inbox.tsx`). Rejected:
  expo-sharing, whose receive is experimental and gives no page title; an
  extension that writes the save itself, which would put the database, the
  outbox and the credential in the App Group; and a `save?url` deep link, which
  any page could fire.

## Repo guards, vendoring and tooling

- **THE PHONE SHIPS THROUGH EAS TO TESTFLIGHT, AND AN UNSET CLOUD URL IS THE
  PRODUCTION ORIGIN ON BOTH CLIENTS.** `pnpm testflight:mobile` builds on EAS
  and submits, iPhone only (owner decision); the signing credentials live on
  EAS, never in the repo, and build numbers are EAS's (`appVersionSource:
  remote` in `apps/mobile/eas.json`), so no commit bumps one. The marketing
  version is `apps/mobile/package.json`'s, one product version with the CLI and
  the desktop, and EAS builds with the repo's node and pnpm
  (`tools/repo-guards/src/release-versions.test.ts`). A JS-only fix is an EAS
  Update to builds of the same native fingerprint, a native change a new build
  (owner decision). `PRODUCTION_CLOUD_ORIGIN` (`@repo/contract/cloud/origin`) is
  the one spelling the CLI's config and the phone's `getCloudUrl` fall back to;
  the phone reads `EXPO_PUBLIC_CLOUD_URL` at bundle time and refuses a malformed
  one. Rejected: per-profile env in `eas.json`, a second spelling of the origin,
  and a fallback to a dead host, which made a misconfigured build one that could
  only fail. The share extension is a target of its own in the App Group
  `group.com.inteligir.mobile`, both the plugin's defaults and both signed by
  EAS, and the App Group's defaults are a declared reason (`1C8F.1`).
  `apps/mobile/src/app-config.test.ts` holds the store config to what
  App Store Connect judges: the group, exactly one app extension, its
  activation rules, and every reason.
