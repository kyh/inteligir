# Decisions: @repo/extension

The browser extension: whose sign-in it rides, what it reads of a page, how it saves and waits,
what it may reach, and how it builds.

## Browser extension

- **The extension rides the browser's own sign-in to the site, and the site's connect page names the
  site.** The worker sends the site's signed session cookie as `/v1`'s bearer, and the connect page
  hands it only the site's origin, since a credential of its own outlived the browser's sign-out.
  `apps/extension/src/background/sign-in.ts`.
- **The extension has no sign-out of its own: the site's signs it out.** The popup and the welcome
  page say who is signed in and link the site, since a Disconnect left the browser signed in on the
  site. `apps/extension/src/entrypoints/welcome/app.tsx`.
- **The extension reads the page itself, over the DOM the person sees, and saves it read.** The
  capture clones the rendered DOM without form values, and a page it cannot script or read is saved
  as its link for the cloud's fill. `apps/extension/src/capture/serialize-page.ts`.
- **No copy of the page: an item keeps what the extension read, and Open original opens the page.**
  No device opens a copy, and an `activeTab` extension cannot fetch a page's stylesheets, fonts and
  pictures across origins. `apps/extension/src/background/save-page.ts`.
- **A save is queued before its first call, as its address and title, and an alarm sends what
  waits.** One `storage.local` key a save, resent every 30 s and at every start under the account it
  was made in, since the worker dies 30 s after its last event.
  `apps/extension/src/background/save-queue.ts`.
- **A save's try settles it one way, the first and every resend alike, and one pass sends the queue
  at a time.** `settle` reads the contract's `sharedFailure` as the tab and the phone do, since a
  pass per trigger sent each save twice. `apps/extension/src/background/cloud.ts`.
- **The account and the queue are storage's, the session the browser's jar, and the worker holds
  nothing.** `storage.local` is open to trusted contexts alone, so the capture script reads neither,
  and every listener registers in `main()`'s first turn.
  `apps/extension/src/entrypoints/background.ts`.
- **`activeTab` and the cloud's site, never `<all_urls>`.** The site's host reads its session cookie
  with no CORS and a click grants the tab a save is made over, since `<all_urls>` warns that every
  page is readable at any time. `apps/extension/src/manifest.ts`.
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
  and the zip's hook refuses any manifest but production's. `apps/extension/package.json`.
