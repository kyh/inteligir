# Decisions: @repo/extension

The browser extension: whose sign-in it rides, what it reads of a page, how it saves and waits,
what it may reach, and how it builds.

## Browser extension

- **The extension rides the browser's own sign-in to the site.** The worker sends the site's signed
  session cookie as `/v1`'s bearer, since a credential of its own outlives the browser's sign-out.
  `apps/extension/src/background/sign-in.ts`.
- **The account kept is the one the cloud read the jar's cookie as, or nobody's.** It is kept with
  that cookie's SHA-256 and signed in only under the same cookie, since an email paired with
  whatever cookie the jar holds sends one account's save under another's session.
  `apps/extension/src/background/connection.ts`.
- **A build knows its site, and no page messages the extension.** A store build's cloud is a literal
  in its bundle and only a dev build's storage names another local app, since a page that names
  the site hands a store build what it already holds. `apps/extension/src/background/connection.ts`.
- **The extension has no sign-out of its own: the site's signs it out.** The popup and the welcome
  page say who is signed in and link the site, since a Disconnect of its own leaves the browser signed in on the
  site. `apps/extension/src/entrypoints/welcome/app.tsx`.
- **The extension reads the page itself, over the DOM the person sees, and saves it read.** The
  capture clones the rendered DOM without form values, and a page it cannot script or read is saved
  as its link for the cloud's fill. `apps/extension/src/capture/serialize-page.ts`.
- **No copy of the page: an item keeps what the extension read, and Open original opens the page.**
  No device opens a copy, and an `activeTab` extension cannot fetch a page's stylesheets, fonts and
  pictures across origins. `apps/extension/src/background/save-page.ts`.
- **A save is queued before its first call, as its address and title, and what it waits for sends
  it.** One `storage.local` key a save: an alarm every 30 s while a call is on its way or went
  unanswered, since the worker dies 30 s after its last event, and the site's session cookie or the
  worker's start for a save that waits on a sign-in or an update, which no timer brings.
  `apps/extension/src/background/save-queue.ts`.
- **The queue is `@repo/client`'s waiting saves, the phone's too, and the extension keeps only what
  is its own.** The send under a save's own account, a first try outside a pass and the alarm are
  here; the record, the pass and what a call's outcome does to a save are shared, since two queues
  answer one refusal two ways. `apps/extension/src/background/save-queue.ts`.
- **A save the library refused is listed in the popup, in the library's words, to try again or let
  go, beside a count of those that wait.** Only the saves of the account signed in, read with no
  call, since a refusal a resend meets has no tab to badge and a save dropped unseen is lost.
  `apps/extension/src/entrypoints/popup/app.tsx`.
- **One save an address for each account, waiting or refused: the queue keeps saves of one page as
  one.** The popup saves its tab each time it opens, so a save for each opening counts one page
  once an opening offline and lists it once an opening while the library stays full.
  `apps/extension/src/background/save-queue.ts`.
- **The account and the queue are storage's, the session the browser's jar, and the worker holds
  only what stops with it.** A pass and a first try under way are memory's, since a mark of either
  on disk outlives the worker that made it; `storage.local` is open to trusted contexts alone, and
  every listener registers in `main()`'s first turn. `apps/extension/src/entrypoints/background.ts`.
- **`activeTab` and the cloud's site, never `<all_urls>`.** The site's host reads its session cookie
  with no CORS and a click grants the tab a save is made over, since `<all_urls>` warns that every
  page is readable at any time.
  `apps/extension/src/manifest.ts`.
- **The build floor holds the extension as it holds every client.** Every call names
  `<version>+extension`, the product's version, so the one `MIN_CLIENT_BUILD` refuses it, since a
  version of its own needs a floor per platform. `apps/extension/src/background/cloud.ts`.
- **The id is the committed key's, and the store zip strips it.** The dev and unpacked store builds
  carry `EXTENSION_PUBLIC_KEY`, so the id is known before any listing, and the Web Store signs the
  zip with its own. `packages/contract/src/extension/extension-identity.ts`.
- **WXT builds it, as kyh/init builds its extension** (owner decision). The manifest is a function
  of the mode and the worker's suites run under node with its conditions, so no worker suite passes
  on a DOM the worker lacks. `apps/extension/wxt.config.ts`.
- **`browser.*` at Chrome 148, and a production zip that checks itself** (owner decision). From
  Chrome 148 every API is under `browser`, so `@types/chrome` would be a second spelling of each,
  and the build's hooks refuse a zip of any manifest but production's.
  `apps/extension/package.json`.
